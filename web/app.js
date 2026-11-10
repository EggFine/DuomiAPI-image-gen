(() => {
  const state = {
    info: null,
    config: null,
    models: [],
    ratioPresets: [],
    selectedModel: "gpt-image-2.6-flare",
    selectedRatio: "1:1",
    selectedSize: "1024x1024",
    preferredTier: "1k",
    referenceImages: [], // { type: 'url'|'base64', value: string, preview: string, label: string }
    records: [],
    filter: "all",
    searchQuery: "",
    activeLightboxRecord: null,
    activeLightboxImageUrl: "",
    pollTimer: null,
  };

  const el = (id) => document.getElementById(id);

  function showToast(message, type = "info") {
    const container = el("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3600);
  }

  async function apiFetch(url, options = {}) {
    const resp = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || `请求失败 (HTTP ${resp.status})`);
    }
    return data;
  }

  async function init() {
    bindEvents();
    try {
      const [info, cfg, recData] = await Promise.all([
        apiFetch("/api/info"),
        apiFetch("/api/config"),
        apiFetch("/api/records"),
      ]);
      state.info = info;
      state.config = cfg;
      state.models = info.models || [];
      state.ratioPresets = info.ratio_presets || [];
      state.selectedModel = cfg.default_model || "gpt-image-2.6-flare";
      state.records = recData.records || [];

      el("data-dir-badge").textContent = info.data_dir || "./duomi_data";
      el("data-dir-badge").title = `绿色数据目录: ${info.data_dir}`;
      el("chk-oversea").checked = !!cfg.oversea;

      const initialSize =
        cfg.default_size && cfg.default_size !== "auto" ? cfg.default_size : "1024x1024";
      selectSizeOrRatioFromValue(initialSize);

      updateKeyStatusUI();
      renderModels();
      renderRecords();
      ensureAutoRefreshLoop();

      if (!cfg.api_key) {
        openConfigModal();
      }
    } catch (err) {
      showToast("初始化加载失败: " + err.message, "error");
    }
  }

  function updateKeyStatusUI() {
    const hasKey = !!(state.config && state.config.api_key && state.config.api_key.trim());
    const dot = el("key-status-dot");
    const text = el("key-status-text");
    if (hasKey) {
      dot.classList.add("ready");
      const masked = maskKey(state.config.api_key);
      text.textContent = `已配置密钥 (${masked})`;
    } else {
      dot.classList.remove("ready");
      text.textContent = "未配置 API Key (点击设置)";
    }
  }

  function maskKey(k) {
    const s = (k || "").trim();
    if (s.length <= 8) return "****";
    return s.slice(0, 4) + "..." + s.slice(-4);
  }

  function renderModels() {
    const container = el("model-cards-container");
    container.innerHTML = "";
    state.models.forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `model-card ${state.selectedModel === m.id ? "active" : ""}`;
      btn.innerHTML = `
        <div class="model-card-main">
          <div class="model-card-title">
            <span>${escapeHtml(m.name)}</span>
            <span class="model-badge">${escapeHtml(m.badge)}</span>
          </div>
          <div class="model-card-desc">${escapeHtml(m.description)}</div>
        </div>
        <span class="model-price">${escapeHtml(m.price)}</span>
      `;
      btn.addEventListener("click", () => {
        state.selectedModel = m.id;
        el("input-custom-model").value = "";
        renderModels();
      });
      container.appendChild(btn);
    });
  }

  function selectSizeOrRatioFromValue(sizeVal) {
    const target = (sizeVal || "1024x1024").trim();
    for (const grp of state.ratioPresets) {
      const found = (grp.sizes || []).find((s) => s.value === target);
      if (found) {
        state.selectedRatio = grp.ratio;
        state.selectedSize = found.value;
        if (found.tier && found.tier !== "auto") {
          state.preferredTier = found.tier;
        }
        renderRatioAndSizeUI();
        return;
      }
    }
    // Check if it matches a ratio directly
    const directGrp = state.ratioPresets.find((g) => g.ratio === target);
    if (directGrp) {
      state.selectedRatio = directGrp.ratio;
      state.selectedSize = directGrp.default_size || target;
      renderRatioAndSizeUI();
      return;
    }
    // Otherwise treat as custom WxH
    state.selectedRatio = "custom";
    state.selectedSize = target;
    const parts = target.toLowerCase().split("x");
    if (parts.length === 2) {
      el("input-custom-w").value = parseInt(parts[0], 10) || 1024;
      el("input-custom-h").value = parseInt(parts[1], 10) || 1024;
    }
    renderRatioAndSizeUI();
  }

  function renderRatioAndSizeUI() {
    const ratioContainer = el("ratio-pills-container");
    const sizeContainer = el("size-presets-container");
    const customPanel = el("custom-size-panel");

    ratioContainer.innerHTML = "";
    state.ratioPresets.forEach((grp) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ratio-pill ${state.selectedRatio === grp.ratio ? "active" : ""}`;
      btn.textContent = grp.name;
      btn.addEventListener("click", () => {
        state.selectedRatio = grp.ratio;
        const sizes = grp.sizes || [];
        // Try to match user's preferred tier (e.g. 1k / 2k / 4k / ratio) when switching ratio
        const matched =
          sizes.find((s) => s.tier === state.preferredTier) ||
          sizes.find((s) => s.value === grp.default_size) ||
          sizes[0];
        if (matched) {
          state.selectedSize = matched.value;
        }
        renderRatioAndSizeUI();
      });
      ratioContainer.appendChild(btn);
    });

    // Add Custom pill at the end
    const customBtn = document.createElement("button");
    customBtn.type = "button";
    customBtn.className = `ratio-pill ${state.selectedRatio === "custom" ? "active" : ""}`;
    customBtn.textContent = "自定义宽高";
    customBtn.addEventListener("click", () => {
      state.selectedRatio = "custom";
      if (!el("input-custom-w").value || !el("input-custom-h").value) {
        const parts = (state.selectedSize || "").split("x");
        el("input-custom-w").value = parseInt(parts[0], 10) || 1024;
        el("input-custom-h").value = parseInt(parts[1], 10) || 1024;
      }
      renderRatioAndSizeUI();
    });
    ratioContainer.appendChild(customBtn);

    // Render Step 2: Size presets for the selected ratio
    sizeContainer.innerHTML = "";
    if (state.selectedRatio === "custom") {
      el("current-ratio-label").textContent = "自定义宽高";
      el("current-size-label").textContent = state.selectedSize;
      customPanel.hidden = false;
      return;
    }

    customPanel.hidden = true;
    const activeGrp =
      state.ratioPresets.find((g) => g.ratio === state.selectedRatio) ||
      state.ratioPresets[0];
    if (!activeGrp) return;

    el("current-ratio-label").textContent = activeGrp.name;
    el("current-size-label").textContent = state.selectedSize;

    const sizes = activeGrp.sizes || [];
    sizes.forEach((item, idx) => {
      const card = document.createElement("button");
      card.type = "button";
      const isSpanFull = sizes.length % 2 === 1 && idx === sizes.length - 1;
      card.className = `size-preset-card ${isSpanFull ? "span-full" : ""} ${
        state.selectedSize === item.value ? "active" : ""
      }`;
      card.innerHTML = `
        <span class="size-preset-label">${escapeHtml(item.label)}</span>
        <span class="size-preset-detail">${escapeHtml(item.detail)}</span>
      `;
      card.addEventListener("click", () => {
        state.selectedSize = item.value;
        if (item.tier && item.tier !== "auto") {
          state.preferredTier = item.tier;
        }
        renderRatioAndSizeUI();
      });
      sizeContainer.appendChild(card);
    });
  }

  function renderRefThumbs() {
    const container = el("ref-thumbs-container");
    el("ref-count-badge").textContent = `${state.referenceImages.length} 张`;
    container.innerHTML = "";
    state.referenceImages.forEach((item, idx) => {
      const div = document.createElement("div");
      div.className = "ref-thumb-item";
      div.innerHTML = `
        <img src="${escapeAttr(item.preview)}" alt="参考图 ${idx + 1}" />
        <button type="button" class="ref-thumb-remove" title="移除此参考图">✕</button>
        <div class="ref-thumb-badge">${escapeHtml(item.label)}</div>
      `;
      div.querySelector(".ref-thumb-remove").addEventListener("click", () => {
        state.referenceImages.splice(idx, 1);
        renderRefThumbs();
      });
      container.appendChild(div);
    });
  }

  async function handleFilesSelected(fileList) {
    const autoCompress = el("chk-compress-ref").checked;
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith("image/")) {
        showToast(`跳过非图片文件: ${file.name}`, "error");
        continue;
      }
      try {
        const result = await processLocalImageFile(file, autoCompress, 300000);
        state.referenceImages.push({
          type: "base64",
          value: result.dataUrl,
          preview: result.dataUrl,
          label: result.label,
        });
      } catch (err) {
        showToast(`读取图片失败 (${file.name}): ${err.message}`, "error");
      }
    }
    renderRefThumbs();
  }

  function processLocalImageFile(file, autoCompress, maxBytes) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("文件读取错误"));
      reader.onload = () => {
        const rawDataUrl = reader.result;
        if (!autoCompress || file.size <= maxBytes) {
          const kb = Math.round(file.size / 1024);
          resolve({ dataUrl: rawDataUrl, label: `原图 ${kb}KB` });
          return;
        }
        // Compress using Canvas so base64 payload stays under limit
        const img = new Image();
        img.onerror = () => resolve({ dataUrl: rawDataUrl, label: `${Math.round(file.size / 1024)}KB` });
        img.onload = () => {
          const dims = [1280, 1024, 768, 512, 384];
          const qualities = [0.88, 0.76, 0.62];
          for (const maxDim of dims) {
            let w = img.width;
            let h = img.height;
            if (w > maxDim || h > maxDim) {
              if (w >= h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);

            for (const q of qualities) {
              const compressed = canvas.toDataURL("image/jpeg", q);
              const approxBytes = Math.round((compressed.length * 3) / 4);
              if (approxBytes <= maxBytes) {
                resolve({
                  dataUrl: compressed,
                  label: `已优压 ${Math.round(approxBytes / 1024)}KB`,
                });
                return;
              }
            }
          }
          resolve({ dataUrl: rawDataUrl, label: `${Math.round(file.size / 1024)}KB` });
        };
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function applyCustomSize() {
    let w = parseInt(el("input-custom-w").value, 10);
    let h = parseInt(el("input-custom-h").value, 10);
    if (isNaN(w) || isNaN(h)) {
      showToast("请输入有效的宽度和高度整数", "error");
      return;
    }
    // Snap to nearest multiple of 16 within [16, 3840]
    w = Math.max(16, Math.min(3840, Math.round(w / 16) * 16));
    h = Math.max(16, Math.min(3840, Math.round(h / 16) * 16));
    el("input-custom-w").value = w;
    el("input-custom-h").value = h;

    const pixels = w * h;
    if (pixels < 655360 || pixels > 8294400) {
      showToast(
        `当前 ${w}×${h} 总像素为 ${pixels.toLocaleString()}，需在 [655,360 ~ 8,294,400] 范围内`,
        "error"
      );
      return;
    }
    state.selectedRatio = "custom";
    state.selectedSize = `${w}x${h}`;
    renderRatioAndSizeUI();
    showToast(`已应用自定义尺寸: ${state.selectedSize} (已自动对齐16倍数)`, "success");
  }

  async function submitGenerateTask() {
    const prompt = el("input-prompt").value.trim();
    if (!prompt) {
      showToast("请输入画面描述词 (Prompt)", "error");
      el("input-prompt").focus();
      return;
    }
    if (!state.config || !state.config.api_key) {
      showToast("请先配置多米 API Key", "error");
      openConfigModal();
      return;
    }

    const customModel = el("input-custom-model").value.trim();
    const model = customModel || state.selectedModel || "gpt-image-2.6-flare";
    const quality = el("select-quality").value;
    const background = el("select-background").value;
    const n = parseInt(el("input-count-n").value, 10) || 1;
    const oversea = el("chk-oversea").checked;
    const images = state.referenceImages.map((item) => item.value);

    const btn = el("btn-submit-generate");
    btn.disabled = true;
    btn.textContent = "正在提交任务...";

    try {
      const record = await apiFetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          model,
          prompt,
          size: state.selectedSize,
          image: images,
          quality,
          background,
          n,
          oversea,
        }),
      });
      showToast(`任务已提交 (ID: ${record.id.slice(0, 8)}...)，正在后台自动轮询`, "success");
      await refreshRecords();
      ensureAutoRefreshLoop();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "立即提交异步生图任务";
    }
  }

  async function refreshRecords() {
    try {
      const data = await apiFetch("/api/records");
      state.records = data.records || [];
      renderRecords();
    } catch (err) {
      console.error("刷新记录失败:", err);
    }
  }

  function ensureAutoRefreshLoop() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    const hasActive = state.records.some(
      (r) => r.state === "pending" || r.state === "running"
    );
    if (hasActive) {
      state.pollTimer = setInterval(async () => {
        await refreshRecords();
        const stillActive = state.records.some(
          (r) => r.state === "pending" || r.state === "running"
        );
        if (!stillActive && state.pollTimer) {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
        }
      }, 2500);
    }
  }

  function renderRecords() {
    const allCount = state.records.length;
    const activeCount = state.records.filter(
      (r) => r.state === "pending" || r.state === "running"
    ).length;
    const succeededCount = state.records.filter((r) => r.state === "succeeded").length;
    const failedCount = state.records.filter(
      (r) => r.state === "error" || r.state === "failed" || r.state === "timeout"
    ).length;

    el("count-all").textContent = allCount;
    el("count-active").textContent = activeCount;
    el("count-succeeded").textContent = succeededCount;
    el("count-failed").textContent = failedCount;

    const q = state.searchQuery.toLowerCase();
    const filtered = state.records.filter((r) => {
      if (state.filter === "active" && r.state !== "pending" && r.state !== "running") {
        return false;
      }
      if (state.filter === "succeeded" && r.state !== "succeeded") {
        return false;
      }
      if (
        state.filter === "failed" &&
        r.state !== "error" &&
        r.state !== "failed" &&
        r.state !== "timeout"
      ) {
        return false;
      }
      if (q) {
        const hay = `${r.id} ${r.model} ${r.prompt}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });

    const grid = el("records-grid");
    grid.innerHTML = "";

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div style="font-size:15px; font-weight:600; color:var(--text-primary);">暂无匹配的图像生成记录</div>
          <div>在左侧选择模型并输入描述词即可创建任务；所有生成的图片与记录都会自动保存在 <code>duomi_data/</code> 目录中。</div>
        </div>
      `;
      return;
    }

    filtered.forEach((rec) => {
      const card = document.createElement("article");
      card.className = "record-card";

      const stateLabel = formatStateLabel(rec.state, rec.progress);
      const timeStr = formatUnixTime(rec.create_time);
      const images = rec.images || [];

      let mediaHtml = "";
      if (rec.state === "succeeded" && images.length > 0) {
        const multiClass = images.length > 1 ? "multi-grid" : "";
        const imgsMarkup = images
          .map((img, idx) => {
            const src = img.local_file ? `/images/${encodeURIComponent(img.local_file)}` : img.remote_url;
            return `<img src="${escapeAttr(src)}" alt="${escapeAttr(rec.prompt)}" data-idx="${idx}" loading="lazy" />`;
          })
          .join("");
        mediaHtml = `<div class="record-media ${multiClass}">${imgsMarkup}</div>`;
      } else if (rec.state === "pending" || rec.state === "running") {
        const pct = Math.max(8, rec.progress || (rec.state === "running" ? 45 : 15));
        mediaHtml = `
          <div class="record-media">
            <div class="record-placeholder">
              <div class="spinner"></div>
              <div style="font-size:13px; font-weight:500;">${escapeHtml(stateLabel)}</div>
              <div class="progress-track">
                <div class="progress-fill" style="width:${pct}%"></div>
              </div>
              <div class="section-hint">任务 ID: ${escapeHtml(rec.id.slice(0, 18))}...</div>
            </div>
          </div>
        `;
      } else {
        mediaHtml = `
          <div class="record-media">
            <div class="record-placeholder">
              <div style="color:var(--status-danger); font-weight:600;">生成未成功 (${escapeHtml(rec.state)})</div>
              <div style="font-size:12px; color:var(--text-secondary); max-width:280px;">
                ${escapeHtml(rec.error_msg || "可点击下方“刷新状态”重试查询")}
              </div>
            </div>
          </div>
        `;
      }

      const tags = [
        `<span class="meta-tag">${escapeHtml(rec.model)}</span>`,
        rec.size ? `<span class="meta-tag">${escapeHtml(rec.size)}</span>` : "",
        rec.quality ? `<span class="meta-tag">quality:${escapeHtml(rec.quality)}</span>` : "",
        rec.background && rec.background !== "auto"
          ? `<span class="meta-tag">bg:${escapeHtml(rec.background)}</span>`
          : "",
        rec.ref_count > 0 ? `<span class="meta-tag">参考图×${rec.ref_count}</span>` : "",
      ]
        .filter(Boolean)
        .join("");

      card.innerHTML = `
        ${mediaHtml}
        <div class="record-body">
          <div class="record-meta-top">
            <span class="state-pill ${escapeAttr(rec.state)}">${escapeHtml(stateLabel)}</span>
            <span class="record-time">${escapeHtml(timeStr)}</span>
          </div>
          <div class="record-prompt" title="${escapeAttr(rec.prompt)}">${escapeHtml(rec.prompt)}</div>
          <div class="record-tags">${tags}</div>
          <div class="record-footer">
            <div style="display:flex; gap:4px;">
              <button type="button" class="btn btn-ghost act-refresh" title="立即向多米API查询最新状态">刷新状态</button>
              <button type="button" class="btn btn-ghost act-reuse" title="将该任务的提示词与参数填入左侧工作台">复用参数</button>
              <button type="button" class="btn btn-ghost act-copy-id" title="复制任务 ID">复制ID</button>
            </div>
            <button type="button" class="btn btn-danger-ghost act-delete" title="删除此条记录">删除</button>
          </div>
        </div>
      `;

      // Image click -> open Lightbox
      card.querySelectorAll(".record-media img").forEach((imgEl) => {
        imgEl.addEventListener("click", () => {
          const idx = parseInt(imgEl.dataset.idx, 10) || 0;
          openLightbox(rec, idx);
        });
      });

      // Refresh button
      card.querySelector(".act-refresh").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "查询中...";
        try {
          await apiFetch("/api/tasks/query", {
            method: "POST",
            body: JSON.stringify({ task_id: rec.id }),
          });
          await refreshRecords();
          ensureAutoRefreshLoop();
          showToast("已同步任务最新状态", "success");
        } catch (err) {
          showToast(err.message, "error");
        } finally {
          btn.disabled = false;
          btn.textContent = "刷新状态";
        }
      });

      // Reuse params button
      card.querySelector(".act-reuse").addEventListener("click", () => {
        reuseRecordParams(rec);
      });

      // Copy Task ID
      card.querySelector(".act-copy-id").addEventListener("click", () => {
        navigator.clipboard.writeText(rec.id);
        showToast(`已复制任务 ID: ${rec.id}`, "success");
      });

      // Delete record
      card.querySelector(".act-delete").addEventListener("click", async () => {
        if (!confirm(`确定删除任务记录 ${rec.id.slice(0, 8)}... 吗？（同时删除对应本地图片文件）`)) {
          return;
        }
        try {
          await apiFetch(`/api/records?id=${encodeURIComponent(rec.id)}&delete_files=true`, {
            method: "DELETE",
          });
          await refreshRecords();
          showToast("记录已删除", "info");
        } catch (err) {
          showToast(err.message, "error");
        }
      });

      grid.appendChild(card);
    });
  }

  function reuseRecordParams(rec) {
    el("input-prompt").value = rec.prompt || "";
    el("prompt-char-count").textContent = `${(rec.prompt || "").length} / 5000`;
    const knownModel = state.models.some((m) => m.id === rec.model);
    if (knownModel) {
      state.selectedModel = rec.model;
      el("input-custom-model").value = "";
    } else if (rec.model) {
      el("input-custom-model").value = rec.model;
    }
    renderModels();

    if (rec.size) {
      selectSizeOrRatioFromValue(rec.size);
    }
    el("select-quality").value = rec.quality || "";
    el("select-background").value = rec.background || "auto";
    el("input-count-n").value = rec.n || 1;
    el("chk-oversea").checked = !!rec.oversea;
    showToast("已将该任务的参数填入左侧创作台", "success");
  }

  function openLightbox(rec, imgIdx = 0) {
    const imgItem = (rec.images || [])[imgIdx];
    if (!imgItem) return;
    const src = imgItem.local_file
      ? `/images/${encodeURIComponent(imgItem.local_file)}`
      : imgItem.remote_url;
    const downloadHref = imgItem.local_file
      ? `/images/${encodeURIComponent(imgItem.local_file)}?download=1`
      : imgItem.remote_url;

    state.activeLightboxRecord = rec;
    state.activeLightboxImageUrl = src;

    el("lightbox-img").src = src;
    el("lightbox-task-id").textContent = rec.id;
    el("lightbox-prompt").textContent = rec.prompt;
    el("lightbox-meta").textContent = [
      `模型: ${rec.model}`,
      `尺寸: ${rec.size || "auto"}`,
      `思考深度: ${rec.quality || "默认"}`,
      `背景: ${rec.background || "auto"}`,
      `本地文件: ${imgItem.local_file ? "duomi_data/images/" + imgItem.local_file : "未保存本地"}`,
      `创建时间: ${formatUnixTime(rec.create_time)}`,
    ].join("\n");

    const dlLink = el("lightbox-download-link");
    dlLink.href = downloadHref;
    dlLink.download = imgItem.local_file || `duomi_${rec.id}.png`;

    el("modal-lightbox").hidden = false;
  }

  function openConfigModal() {
    if (state.config) {
      el("cfg-api-key").value = state.config.api_key || "";
      el("cfg-base-url").value = state.config.base_url || "https://duomiapi.com";
      el("cfg-poll-interval").value = state.config.poll_interval || 4;
      el("cfg-poll-timeout").value = state.config.poll_timeout || 300;
      el("cfg-auto-download").checked = state.config.auto_download !== false;
    }
    el("modal-config").hidden = false;
  }

  function bindEvents() {
    // Prompt counter & quick tags
    const promptInput = el("input-prompt");
    promptInput.addEventListener("input", () => {
      el("prompt-char-count").textContent = `${promptInput.value.length} / 5000`;
    });

    document.querySelectorAll(".quick-tag[data-snippet]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const snippet = btn.dataset.snippet;
        const cur = promptInput.value.trim();
        promptInput.value = cur ? `${cur}，${snippet}` : snippet;
        el("prompt-char-count").textContent = `${promptInput.value.length} / 5000`;
      });
    });

    el("btn-clear-prompt").addEventListener("click", () => {
      promptInput.value = "";
      el("prompt-char-count").textContent = "0 / 5000";
    });

    // Reference images upload & drag-drop
    const fileInput = el("input-local-file");
    el("btn-select-local-image").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFilesSelected(e.target.files);
        fileInput.value = "";
      }
    });

    const dropZone = el("ref-drop-zone");
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFilesSelected(e.dataTransfer.files);
      }
    });

    el("btn-add-ref-url").addEventListener("click", () => {
      const urlVal = el("input-ref-url").value.trim();
      if (!urlVal) return;
      if (!urlVal.startsWith("http://") && !urlVal.startsWith("https://")) {
        showToast("请输入以 http:// 或 https:// 开头的图片直链", "error");
        return;
      }
      state.referenceImages.push({
        type: "url",
        value: urlVal,
        preview: urlVal,
        label: "直链 URL",
      });
      el("input-ref-url").value = "";
      renderRefThumbs();
    });

    el("btn-apply-custom-size").addEventListener("click", applyCustomSize);

    // Submit generation
    el("btn-submit-generate").addEventListener("click", submitGenerateTask);

    // Filter tabs & search
    document.querySelectorAll(".filter-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        state.filter = tab.dataset.filter;
        renderRecords();
      });
    });

    el("input-search-records").addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim();
      renderRecords();
    });

    el("btn-refresh-records").addEventListener("click", async () => {
      await refreshRecords();
      showToast("已刷新记录列表", "info");
    });

    // Config Modal
    el("btn-open-config-modal").addEventListener("click", openConfigModal);
    el("btn-close-config-modal").addEventListener("click", () => (el("modal-config").hidden = true));
    el("btn-cancel-config").addEventListener("click", () => (el("modal-config").hidden = true));
    el("btn-toggle-key-visibility").addEventListener("click", () => {
      const inp = el("cfg-api-key");
      inp.type = inp.type === "password" ? "text" : "password";
    });
    el("btn-save-config").addEventListener("click", async () => {
      const payload = {
        api_key: el("cfg-api-key").value.trim(),
        base_url: el("cfg-base-url").value.trim() || "https://duomiapi.com",
        default_model: state.selectedModel,
        default_size: state.selectedSize,
        poll_interval: parseInt(el("cfg-poll-interval").value, 10) || 4,
        poll_timeout: parseInt(el("cfg-poll-timeout").value, 10) || 300,
        auto_download: el("cfg-auto-download").checked,
        oversea: el("chk-oversea").checked,
      };
      try {
        const saved = await apiFetch("/api/config", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.config = saved;
        updateKeyStatusUI();
        el("modal-config").hidden = true;
        showToast("配置已保存到 duomi_data/config.json", "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    // Query Modal
    el("btn-open-query-modal").addEventListener("click", () => {
      el("input-query-task-id").value = "";
      el("modal-query").hidden = false;
      el("input-query-task-id").focus();
    });
    el("btn-close-query-modal").addEventListener("click", () => (el("modal-query").hidden = true));
    el("btn-cancel-query").addEventListener("click", () => (el("modal-query").hidden = true));
    el("btn-confirm-query").addEventListener("click", async () => {
      const taskID = el("input-query-task-id").value.trim();
      if (!taskID) {
        showToast("请输入任务 ID", "error");
        return;
      }
      const btn = el("btn-confirm-query");
      btn.disabled = true;
      btn.textContent = "查询中...";
      try {
        await apiFetch("/api/tasks/query", {
          method: "POST",
          body: JSON.stringify({ task_id: taskID }),
        });
        el("modal-query").hidden = true;
        await refreshRecords();
        ensureAutoRefreshLoop();
        showToast(`已成功同步任务 ${taskID.slice(0, 8)}...`, "success");
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "立即查询并同步";
      }
    });

    // Lightbox Modal
    el("btn-close-lightbox").addEventListener("click", () => (el("modal-lightbox").hidden = true));
    el("btn-lightbox-reuse-params").addEventListener("click", () => {
      if (state.activeLightboxRecord) {
        reuseRecordParams(state.activeLightboxRecord);
        el("modal-lightbox").hidden = true;
      }
    });
    el("btn-lightbox-use-as-ref").addEventListener("click", async () => {
      if (!state.activeLightboxImageUrl) return;
      try {
        const resp = await fetch(state.activeLightboxImageUrl);
        const blob = await resp.blob();
        const file = new File([blob], "gallery_ref.png", { type: blob.type || "image/png" });
        await handleFilesSelected([file]);
        el("modal-lightbox").hidden = true;
        showToast("已将该图片加入左侧参考图列表", "success");
      } catch (err) {
        showToast("添加参考图失败: " + err.message, "error");
      }
    });
  }

  function formatStateLabel(st, progress) {
    switch (st) {
      case "succeeded":
        return "已完成";
      case "pending":
        return "队列中";
      case "running":
        return progress ? `生成中 ${progress}%` : "生成中";
      case "timeout":
        return "轮询超时";
      case "error":
      case "failed":
        return "生成失败";
      default:
        return st || "未知";
    }
  }

  function formatUnixTime(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
