package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// LogEntry represents a single sanitized diagnostic log record stored in memory and on disk.
type LogEntry struct {
	ID        int64          `json:"id"`
	Timestamp string         `json:"ts"`
	Level     string         `json:"level"`  // DEBUG, INFO, WARN, ERROR
	Source    string         `json:"source"` // server, duomi, imghost, poll, storage, thumb, frontend, cli
	Message   string         `json:"message"`
	Fields    map[string]any `json:"fields,omitempty"`
	Stack     string         `json:"stack,omitempty"`
}

// LogFileInfo describes a rotated log file inside duomi_data/logs/.
type LogFileInfo struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"size_bytes"`
	ModTime   int64  `json:"mod_time"`
}

// AppLogger is a portable, concurrency-safe, rolling daily file logger with secret redaction
// and an in-memory ring buffer for instant UI diagnostics.
type AppLogger struct {
	mu           sync.Mutex
	logsDir      string
	currentDate  string
	currentPart  int
	currentFile  *os.File
	currentBytes int64
	maxFileBytes int64
	maxFiles     int
	maxAgeDays   int

	ring    []LogEntry
	maxRing int
	nextID  int64

	secrets []string
}

var (
	reJSONSecret  = regexp.MustCompile(`(?i)("?(?:api[_-]?key|authorization|custom_upload_auth|access[_-]?token|secret[_-]?key|password)"?\s*[:=]\s*"?)(?:Bearer\s+)?([^\s"',;}{]{4,})`)
	reBearerToken = regexp.MustCompile(`(?i)\b(Bearer\s+)([A-Za-z0-9._\-+/=]{8,})`)
	reQuerySecret = regexp.MustCompile(`(?i)([?&](?:key|api_key|apikey|token|secret)=)([^&\s"']+)`)
	reSKToken     = regexp.MustCompile(`\bsk-[A-Za-z0-9_\-]{12,}\b`)
	reDataURIB64  = regexp.MustCompile(`data:image/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=\s]{64,}`)
)

// MaskSecret masks a sensitive credential while preserving short prefix/suffix hints for debugging.
func MaskSecret(secret string) string {
	s := strings.TrimSpace(secret)
	if s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) <= 8 {
		return "****"
	}
	if len(r) <= 14 {
		return string(r[:2]) + "***" + string(r[len(r)-2:])
	}
	return string(r[:4]) + "***" + string(r[len(r)-4:])
}

// NewAppLogger initializes a rolling portable logger inside logsDir (duomi_data/logs).
func NewAppLogger(logsDir string) (*AppLogger, error) {
	if strings.TrimSpace(logsDir) != "" {
		if err := os.MkdirAll(logsDir, 0755); err != nil {
			return nil, fmt.Errorf("创建日志目录失败 (%s): %w", logsDir, err)
		}
	}
	l := &AppLogger{
		logsDir:      logsDir,
		maxFileBytes: 10 << 20, // 10 MB per file segment
		maxFiles:     30,
		maxAgeDays:   14,
		ring:         make([]LogEntry, 0, 256),
		maxRing:      1200,
	}
	if logsDir != "" {
		l.cleanupOldLogsLocked()
	}
	return l, nil
}

// LogsDir returns the directory where log files are stored.
func (l *AppLogger) LogsDir() string {
	if l == nil {
		return ""
	}
	return l.logsDir
}

// RegisterSecrets adds known credential strings to redact from all future log output.
// Previously registered secrets are preserved for the lifetime of the process so
// calling RegisterSecrets with a single key never wipes other credentials.
func (l *AppLogger) RegisterSecrets(secrets ...string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	seen := make(map[string]bool, len(l.secrets)+len(secrets))
	cleaned := make([]string, 0, len(l.secrets)+len(secrets))
	addCandidate := func(raw string) {
		v := strings.TrimSpace(raw)
		if len(v) < 6 {
			return
		}
		if !seen[v] {
			seen[v] = true
			cleaned = append(cleaned, v)
		}
		norm := NormalizeAPIKey(v)
		if len(norm) >= 6 && !seen[norm] {
			seen[norm] = true
			cleaned = append(cleaned, norm)
		}
	}
	for _, existing := range l.secrets {
		addCandidate(existing)
	}
	for _, s := range secrets {
		addCandidate(s)
	}
	if envKey := os.Getenv("DUOMI_API_KEY"); envKey != "" {
		addCandidate(envKey)
	}
	// Sort longest-first so partial tokens never shadow full tokens
	sort.Slice(cleaned, func(i, j int) bool {
		return len(cleaned[i]) > len(cleaned[j])
	})
	if len(cleaned) > 64 {
		cleaned = cleaned[:64]
	}
	l.secrets = cleaned
}

// RedactString strips sensitive secrets and giant base64 image payloads from any string.
func (l *AppLogger) RedactString(s string) string {
	if s == "" {
		return ""
	}
	var secrets []string
	if l != nil {
		l.mu.Lock()
		if len(l.secrets) > 0 {
			secrets = make([]string, len(l.secrets))
			copy(secrets, l.secrets)
		}
		l.mu.Unlock()
	}
	return redactWithSecrets(s, secrets)
}

func redactWithSecrets(s string, secrets []string) string {
	out := s
	for _, sec := range secrets {
		if sec != "" && strings.Contains(out, sec) {
			out = strings.ReplaceAll(out, sec, MaskSecret(sec))
		}
	}
	out = reDataURIB64.ReplaceAllStringFunc(out, func(match string) string {
		prefix := "data:image/...;base64,"
		if idx := strings.Index(match, ","); idx > 0 && idx < 48 {
			prefix = match[:idx+1]
		}
		return fmt.Sprintf("%s[omitted %d chars]", prefix, len(match))
	})
	out = reBearerToken.ReplaceAllStringFunc(out, func(match string) string {
		parts := reBearerToken.FindStringSubmatch(match)
		if len(parts) == 3 {
			return parts[1] + MaskSecret(parts[2])
		}
		return "Bearer ****"
	})
	out = reJSONSecret.ReplaceAllStringFunc(out, func(match string) string {
		parts := reJSONSecret.FindStringSubmatch(match)
		if len(parts) == 3 {
			return parts[1] + MaskSecret(parts[2])
		}
		return match
	})
	out = reQuerySecret.ReplaceAllString(out, "${1}****")
	out = reSKToken.ReplaceAllStringFunc(out, func(match string) string {
		return MaskSecret(match)
	})
	return out
}

func sanitizeLogFieldValue(v any, secrets []string) any {
	switch val := v.(type) {
	case string:
		redacted := redactWithSecrets(val, secrets)
		if len(redacted) > 800 {
			redacted = truncateUTF8Bytes(redacted, 800) + "...(truncated)"
		}
		return redacted
	case []string:
		out := make([]string, 0, len(val))
		for _, item := range val {
			r := redactWithSecrets(item, secrets)
			if len(r) > 300 {
				r = truncateUTF8Bytes(r, 300) + "..."
			}
			out = append(out, r)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(val))
		for k, mv := range val {
			lk := strings.ToLower(k)
			if strings.Contains(lk, "api_key") || strings.Contains(lk, "apikey") ||
				strings.Contains(lk, "authorization") || strings.Contains(lk, "secret") ||
				strings.Contains(lk, "password") || strings.Contains(lk, "token") {
				if sv, ok := mv.(string); ok {
					out[k] = MaskSecret(sv)
				} else {
					out[k] = "****"
				}
				continue
			}
			out[k] = sanitizeLogFieldValue(mv, secrets)
		}
		return out
	default:
		return v
	}
}

// Log records an entry into the in-memory ring buffer and appends it to the current daily log file.
func (l *AppLogger) Log(level, source, message string, fields map[string]any, stack string) {
	if l == nil {
		return
	}
	lvl := strings.ToUpper(strings.TrimSpace(level))
	switch lvl {
	case "DEBUG", "INFO", "WARN", "ERROR":
	default:
		lvl = "INFO"
	}
	src := strings.ToLower(strings.TrimSpace(source))
	if src == "" {
		src = "app"
	}

	now := time.Now()

	l.mu.Lock()
	defer l.mu.Unlock()

	secrets := l.secrets
	cleanMsg := redactWithSecrets(strings.TrimSpace(message), secrets)
	if len(cleanMsg) > 2000 {
		cleanMsg = truncateUTF8Bytes(cleanMsg, 2000) + "...(truncated)"
	}

	var cleanFields map[string]any
	if len(fields) > 0 {
		cleanFields = make(map[string]any, len(fields))
		for k, v := range fields {
			lk := strings.ToLower(k)
			if strings.Contains(lk, "api_key") || strings.Contains(lk, "apikey") ||
				strings.Contains(lk, "authorization") || strings.Contains(lk, "secret") ||
				strings.Contains(lk, "password") || strings.Contains(lk, "token") {
				if sv, ok := v.(string); ok {
					cleanFields[k] = MaskSecret(sv)
				} else {
					cleanFields[k] = "****"
				}
				continue
			}
			cleanFields[k] = sanitizeLogFieldValue(v, secrets)
		}
	}

	cleanStack := ""
	if strings.TrimSpace(stack) != "" {
		cleanStack = redactWithSecrets(strings.TrimSpace(stack), secrets)
		if len(cleanStack) > 8192 {
			cleanStack = truncateUTF8Bytes(cleanStack, 8192) + "\n...(stack truncated)"
		}
	}

	l.nextID++
	entry := LogEntry{
		ID:        l.nextID,
		Timestamp: now.Format("2006-01-02 15:04:05.000"),
		Level:     lvl,
		Source:    src,
		Message:   cleanMsg,
		Fields:    cleanFields,
		Stack:     cleanStack,
	}

	if len(l.ring) >= l.maxRing {
		copy(l.ring, l.ring[1:])
		l.ring[len(l.ring)-1] = entry
	} else {
		l.ring = append(l.ring, entry)
	}

	if l.logsDir != "" {
		l.writeEntryToFileLocked(now, entry)
	}
}

func (l *AppLogger) Debug(source, msg string, fields map[string]any) {
	l.Log("DEBUG", source, msg, fields, "")
}

func (l *AppLogger) Info(source, msg string, fields map[string]any) {
	l.Log("INFO", source, msg, fields, "")
}

func (l *AppLogger) Warn(source, msg string, fields map[string]any) {
	l.Log("WARN", source, msg, fields, "")
}

func (l *AppLogger) Error(source, msg string, fields map[string]any, stack string) {
	l.Log("ERROR", source, msg, fields, stack)
}

func formatSingleLogLine(e LogEntry) string {
	var b strings.Builder
	b.WriteString(e.Timestamp)
	b.WriteString(" [")
	b.WriteString(e.Level)
	b.WriteString("] [")
	b.WriteString(e.Source)
	b.WriteString("] ")
	b.WriteString(e.Message)
	if len(e.Fields) > 0 {
		if raw, err := json.Marshal(e.Fields); err == nil {
			b.WriteByte(' ')
			b.Write(raw)
		}
	}
	b.WriteByte('\n')
	if e.Stack != "" {
		for _, line := range strings.Split(e.Stack, "\n") {
			b.WriteString("    ")
			b.WriteString(line)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func (l *AppLogger) writeEntryToFileLocked(now time.Time, entry LogEntry) {
	dateStr := now.Format("2006-01-02")
	line := formatSingleLogLine(entry)

	needRotate := l.currentFile == nil || l.currentDate != dateStr || (l.currentBytes+int64(len(line)) > l.maxFileBytes)
	if needRotate {
		if l.currentFile != nil {
			_ = l.currentFile.Close()
			l.currentFile = nil
		}
		if l.currentDate != dateStr {
			l.currentDate = dateStr
			l.currentPart = 0
		} else {
			l.currentPart++
		}
		if err := os.MkdirAll(l.logsDir, 0755); err != nil {
			return
		}
		// Pick first available file name under maxFileBytes for today
		var targetPath string
		for {
			if l.currentPart == 0 {
				targetPath = filepath.Join(l.logsDir, fmt.Sprintf("studio-%s.log", dateStr))
			} else {
				targetPath = filepath.Join(l.logsDir, fmt.Sprintf("studio-%s.%d.log", dateStr, l.currentPart))
			}
			info, err := os.Stat(targetPath)
			if err != nil || info.Size() < l.maxFileBytes {
				break
			}
			l.currentPart++
			if l.currentPart > 99 {
				break
			}
		}
		f, err := os.OpenFile(targetPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			return
		}
		var sz int64
		if info, err := f.Stat(); err == nil {
			sz = info.Size()
		}
		l.currentFile = f
		l.currentBytes = sz
		l.cleanupOldLogsLocked()
	}

	if l.currentFile != nil {
		n, err := l.currentFile.WriteString(line)
		if err == nil {
			l.currentBytes += int64(n)
		}
	}
}

func (l *AppLogger) cleanupOldLogsLocked() {
	entries, err := os.ReadDir(l.logsDir)
	if err != nil {
		return
	}
	type fileMeta struct {
		path    string
		modTime time.Time
	}
	var logFiles []fileMeta
	cutoff := time.Now().AddDate(0, 0, -l.maxAgeDays)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".log") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		full := filepath.Join(l.logsDir, entry.Name())
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(full)
			continue
		}
		logFiles = append(logFiles, fileMeta{path: full, modTime: info.ModTime()})
	}
	if len(logFiles) > l.maxFiles {
		sort.Slice(logFiles, func(i, j int) bool {
			return logFiles[i].modTime.After(logFiles[j].modTime)
		})
		for _, old := range logFiles[l.maxFiles:] {
			_ = os.Remove(old.path)
		}
	}
}

// Query returns recent log entries matching optional level, source, and substring filters (newest-first or chronological).
func (l *AppLogger) Query(limit int, level, source, query string) []LogEntry {
	if l == nil {
		return nil
	}
	if limit <= 0 || limit > 1200 {
		limit = 300
	}
	lvlFilter := strings.ToUpper(strings.TrimSpace(level))
	srcFilter := strings.ToLower(strings.TrimSpace(source))
	qFilter := strings.ToLower(strings.TrimSpace(query))

	l.mu.Lock()
	snapshot := make([]LogEntry, len(l.ring))
	copy(snapshot, l.ring)
	l.mu.Unlock()

	filtered := make([]LogEntry, 0, minInt(limit, len(snapshot)))
	for i := len(snapshot) - 1; i >= 0; i-- {
		e := snapshot[i]
		if lvlFilter != "" && lvlFilter != "ALL" {
			if lvlFilter == "WARN+" {
				if e.Level != "WARN" && e.Level != "ERROR" {
					continue
				}
			} else if e.Level != lvlFilter {
				continue
			}
		}
		if srcFilter != "" && srcFilter != "all" && e.Source != srcFilter {
			continue
		}
		if qFilter != "" {
			line := strings.ToLower(formatSingleLogLine(e))
			if !strings.Contains(line, qFilter) {
				continue
			}
		}
		filtered = append(filtered, e)
		if len(filtered) >= limit {
			break
		}
	}

	// Reverse back into chronological order (oldest -> newest) so copy/paste reads naturally top-to-bottom
	for i, j := 0, len(filtered)-1; i < j; i, j = i+1, j-1 {
		filtered[i], filtered[j] = filtered[j], filtered[i]
	}
	return filtered
}

// FormatPlainText formats log entries into a single copy-pasteable diagnostic report.
func FormatLogEntriesPlainText(entries []LogEntry) string {
	var b strings.Builder
	for _, e := range entries {
		b.WriteString(formatSingleLogLine(e))
	}
	return b.String()
}

// ListFiles returns metadata for all .log files in duomi_data/logs/ sorted newest first.
func (l *AppLogger) ListFiles() []LogFileInfo {
	if l == nil || l.logsDir == "" {
		return []LogFileInfo{}
	}
	entries, err := os.ReadDir(l.logsDir)
	if err != nil {
		return []LogFileInfo{}
	}
	out := make([]LogFileInfo, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".log") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out = append(out, LogFileInfo{
			Name:      entry.Name(),
			SizeBytes: info.Size(),
			ModTime:   info.ModTime().Unix(),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ModTime == out[j].ModTime {
			return out[i].Name > out[j].Name
		}
		return out[i].ModTime > out[j].ModTime
	})
	return out
}

// ReadLogFile safely reads a named .log file from duomi_data/logs/.
func (l *AppLogger) ReadLogFile(name string) ([]byte, error) {
	if l == nil || l.logsDir == "" {
		return nil, fmt.Errorf("日志目录未初始化")
	}
	clean := filepath.Base(strings.TrimSpace(name))
	if clean == "" || clean == "." || clean == ".." || !strings.HasSuffix(strings.ToLower(clean), ".log") {
		return nil, fmt.Errorf("无效的日志文件名")
	}
	return os.ReadFile(filepath.Join(l.logsDir, clean))
}

// ClearRing empties the in-memory ring buffer without deleting historical files on disk.
func (l *AppLogger) ClearRing() {
	if l == nil {
		return
	}
	l.mu.Lock()
	l.ring = l.ring[:0]
	l.mu.Unlock()
}

// Close flushes and closes the active log file handle.
func (l *AppLogger) Close() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.currentFile != nil {
		err := l.currentFile.Close()
		l.currentFile = nil
		return err
	}
	return nil
}
