// js/UI.js — UI 관리 (렌더링 / 프로필 / 설정)

class UIManager {
  constructor(app) {
    this.app = app;
    this._toastTimer = null;

    // 말풍선 색상 프리셋
    this.COLOR_PRESETS = [
      '#1a1a1a','#2563eb','#16a34a','#dc2626','#9333ea',
      '#ea580c','#0891b2','#be185d','#854d0e','#4b5563',
      '#dbeafe','#dcfce7','#fef9c3','#fce7f3','#ede9fe',
      '#fed7aa','#cffafe','#f1f5f9','#fff7ed','#f0fdf4',
    ];
  }

  // ── 테마 ────────────────────────────────────────────────────

  initTheme() {
    document.body.classList.toggle('dark', this.app.state.darkMode);
    const btn = document.getElementById('theme-btn');
    if (btn) btn.innerHTML = this.app.state.darkMode
      ? '<i class="fas fa-sun"></i>'
      : '<i class="fas fa-moon"></i>';
  }

  toggleTheme() {
    this.app.state.darkMode = !this.app.state.darkMode;
    this.app.dataManager.saveThemePreference(this.app.state.darkMode);
    this.initTheme();
  }

  // ── 토스트 ──────────────────────────────────────────────────

  showToast(msg, duration = 2200) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ── 로딩 ────────────────────────────────────────────────────

  toggleLoading(show, msg = '처리 중...') {
    const el = document.getElementById('loading-overlay');
    if (!el) return;
    el.classList.toggle('show', show);
    const txt = el.querySelector('.loading-text');
    if (txt) txt.textContent = msg;
  }

  // ── 감지 배지 업데이트 ──────────────────────────────────────

  updateDetectBadge(platform, count) {
    const el = document.getElementById('detect-badge');
    if (!el) return;
    if (platform) {
      const labels = { band: '밴드', kakao: '카카오톡', discord: '디스코드', roll20: '롤20' };
      el.textContent = `${labels[platform] || platform} 형식 감지됨 · ${count}개`;
      el.className = 'detect-badge found';
    } else {
      el.textContent = '형식을 인식하는 중...';
      el.className = 'detect-badge';
    }
  }

  clearDetectBadge() {
    const el = document.getElementById('detect-badge');
    if (el) { el.textContent = ''; el.className = 'detect-badge'; }
  }

  // ── 메시지 카운트 ────────────────────────────────────────────

  updateMsgCount(n) {
    const el = document.getElementById('msg-count');
    if (el) el.textContent = n ? `${n}개 메시지` : '';
  }

  // ── 메시지 렌더링 ────────────────────────────────────────────

  renderMessages() {
    const container = document.getElementById('chat-container');
    if (!container) return;

    const { messages } = this.app.state;
    if (!messages?.length) {
      // 가상 스크롤 정리
      this._destroyVirtualScroll();
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><i class="fas fa-comment-slash"></i></div>
        <div class="empty-state-text">채팅을 붙여넣고 분석하세요</div>
      </div>`;
      this.updateMsgCount(0);
      return;
    }

    const hidden = this.app.state.hiddenUsers || new Set();
    const visibleMessages = messages.filter(m => !hidden.has(m.username));

    // 플랫폼별 컨테이너 클래스 (avatarShape 클래스 보존)
    const platform = this.app.state.detectedPlatform || '';
    const avatarShapeCls = `avatar-${this.app.state.avatarShape || 'circle'}`;
    container.className = [
      platform ? `platform-${platform}` : '',
      avatarShapeCls,
    ].filter(Boolean).join(' ');

    // Roll20: 페이지네이션 렌더러
    if (platform === 'roll20') {
      this._renderMessagesR20Paged(container, messages, visibleMessages);
      return;
    }

    // 일반 렌더러 (밴드/카카오/디스코드) — 청크 처리로 메인 스레드 블로킹 방지
    this._destroyVirtualScroll();

    const CHUNK = 300; // 한 번에 렌더링할 메시지 수
    const groups = this._groupMessages(visibleMessages);

    // 모든 렌더링 항목을 미리 평탄화
    const items = [];
    for (const group of groups) {
      const { username } = group;
      const isMe = this.app.state.selectedUsers.has(username);
      const displayName = this.app.state.displayNames[username] || username;
      const profileUrl = this.app.state.userProfileImages[username] || null;
      const bubbleColor = this.app.state.userBubbleColors?.[username] || null;
      for (let i = 0; i < group.messages.length; i++) {
        items.push({ group, i, isMe, displayName, profileUrl, bubbleColor });
      }
    }

    if (items.length <= CHUNK) {
      // 소량이면 즉시 렌더링
      const frags = items.map(({ group, i, isMe, displayName, profileUrl, bubbleColor }) => {
        const { index, message } = group.messages[i];
        return this._renderMessage(message, index, isMe, displayName, profileUrl, bubbleColor, i === 0, i === group.messages.length - 1);
      });
      container.innerHTML = frags.join('');
      container.style.fontSize = (this.app.state.fontSize || 14) + 'px';
      this.updateMsgCount(visibleMessages.length);
    } else {
      // 대량이면 청크 단위로 append
      container.innerHTML = '';
      container.style.fontSize = (this.app.state.fontSize || 14) + 'px';
      this.updateMsgCount(visibleMessages.length);

      const renderChunk = (start) => {
        // 렌더링 도중 플랫폼이 바뀌었으면 중단
        if (this.app.state.detectedPlatform === 'roll20') return;

        const end = Math.min(start + CHUNK, items.length);
        const frag = document.createDocumentFragment();
        const tmp = document.createElement('div');

        const html = items.slice(start, end).map(({ group, i, isMe, displayName, profileUrl, bubbleColor }) => {
          const { index, message } = group.messages[i];
          return this._renderMessage(message, index, isMe, displayName, profileUrl, bubbleColor, i === 0, i === group.messages.length - 1);
        }).join('');

        tmp.innerHTML = html;
        while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        container.appendChild(frag);

        if (end < items.length) {
          requestAnimationFrame(() => renderChunk(end));
        }
      };

      renderChunk(0);
    }
  }

  // ── Roll20 가상 스크롤 ──────────────────────────────────────────

  _renderMessagesR20Paged(container, messages, visibleMessages) {
    const PAGE_SIZE = 500;
    const totalPages = Math.max(1, Math.ceil(visibleMessages.length / PAGE_SIZE));

    if (this._r20Page === undefined || this._r20TotalPages !== totalPages) {
      this._r20Page = 0;
    }
    this._r20TotalPages = totalPages;

    const page  = this._r20Page;
    const start = page * PAGE_SIZE;
    const end   = Math.min(start + PAGE_SIZE, visibleMessages.length);
    const pageItems = visibleMessages.slice(start, end);

    const msgIndexMap = new Map();
    messages.forEach((m, idx) => msgIndexMap.set(m, idx));

    const frags = [];
    for (let i = 0; i < pageItems.length; i++) {
      const msg = pageItems[i];
      const origIndex = msgIndexMap.get(msg) ?? (start + i);
      const isMe = this.app.state.selectedUsers.has(msg.username);
      const displayName = this.app.state.displayNames[msg.username] || msg.username;
      const profileUrl  = this.app.state.userProfileImages[msg.username] || null;

      const prev = pageItems[i - 1];
      const isFirstInGroup = !prev
        || prev.username !== msg.username
        || prev.isDesc || msg.isDesc
        || (prev.rawHtml && prev.rawHtml.includes('linear-gradient'))
        || (msg.rawHtml  && msg.rawHtml.includes('linear-gradient'))
        || prev.msgType === 'roll' || msg.msgType === 'roll';

      frags.push(this._renderMessageR20(msg, origIndex, isMe, displayName, profileUrl, isFirstInGroup));
    }

    const navHtml = totalPages > 1 ? this._buildPageNav(page, totalPages, start, end) : '';

    container.innerHTML = navHtml + frags.join('');
    container.style.fontSize = (this.app.state.fontSize || 14) + 'px';
    container.style.padding  = '';
    container.style.overflow = '';
    this.updateMsgCount(visibleMessages.length);

    if (totalPages > 1) {
      container.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = parseInt(btn.dataset.page);
          if (!isNaN(p) && p !== page) {
            this._r20Page = p;
            this._renderMessagesR20Paged(container, messages, visibleMessages);
            container.scrollTop = 0;
          }
        });
      });
    }
  }

  _buildPageNav(page, totalPages, start, end) {
    const pages = [];
    const WING = 2;

    const addPage = (p) => { if (!pages.includes(p) && p >= 0 && p < totalPages) pages.push(p); };

    addPage(0);                                      
    for (let i = page - WING; i <= page + WING; i++) addPage(i); 
    addPage(totalPages - 1);                         
    pages.sort((a, b) => a - b);

    let btns = '';
    for (let i = 0; i < pages.length; i++) {
      if (i > 0 && pages[i] - pages[i - 1] > 1) {
        btns += `<span class="r20-page-ellipsis">…</span>`;
      }
      const p = pages[i];
      btns += `<button class="r20-page-btn r20-page-num${p === page ? ' active' : ''}" data-page="${p}">${p + 1}</button>`;
    }

    return `
      <div class="r20-page-nav" id="r20-page-nav">
        <button class="r20-page-btn r20-page-arrow" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>
          <i class="fas fa-chevron-left"></i>
        </button>
        ${btns}
        <button class="r20-page-btn r20-page-arrow" data-page="${page + 1}" ${page >= totalPages - 1 ? 'disabled' : ''}>
          <i class="fas fa-chevron-right"></i>
        </button>
        <span class="r20-page-info">${start + 1}–${end}번째</span>
      </div>`;
  }

  _destroyVirtualScroll() {
    this._r20Page = undefined;
    this._r20TotalPages = undefined;
  }

  // ── Roll20 전용 렌더러 ────────────────────────────────────────
  _renderMessageR20(msg, index, isMe, displayName, profileUrl, isFirstInGroup = true) {
    const i = index;

    // desc (GM 지문)
    if (msg.isDesc) {
      let content = msg.rawHtml || this._esc(msg.chatMessage).replace(/\n/g,'<br>');
      if (msg.attachedImage) {
        content += `<div class="bubble-img-wrap--center"><img class="bubble-img" src="${this._esc(msg.attachedImage)}" alt=""></div>`;
      }
      return `<div class="r20-msg r20-desc" data-index="${i}" onclick="window.chatApp.startEdit(${i})">${content}</div>`;
    }

    // 판정 pill
    if (msg.rawHtml && msg.rawHtml.includes('linear-gradient')) {
      return `<div class="r20-msg r20-pill" data-index="${i}" onclick="window.chatApp.startEdit(${i})">${msg.rawHtml}</div>`;
    }

    // 주사위 테이블
    if (msg.msgType === 'roll' || msg.msgType === 'roll-unknown' || msg.msgType === 'inline-roll') {
      const avatarHtml = this._r20Avatar(profileUrl);
      let content = msg.rawHtml || this._esc(msg.chatMessage);
      if (msg.attachedImage) {
        content += `<div class="bubble-img-wrap"><img class="bubble-img" src="${this._esc(msg.attachedImage)}" alt=""></div>`;
      }
      return `<div class="r20-msg r20-chat r20-roll-msg" data-index="${i}">
  ${avatarHtml}
  <div class="r20-body" data-edit-body>
    <div class="r20-name msg-name" contenteditable="true" spellcheck="false" onclick="event.stopPropagation()">${this._esc(displayName)}</div>
    <div class="r20-roll-wrap" onclick="window.chatApp.startEdit(${i})">${content}</div>
  </div>
</div>`;
    }

    // 일반 발언
    const customColor = this.app.state.userBubbleColors?.[msg.username] || null;
    const rowBg = customColor || (isMe ? '#dce8f5' : null);
    const rowStyle = rowBg ? ` style="background:${rowBg};${customColor ? 'color:' + this._contrastColor(rowBg) + ';' : ''}"` : '';

    let content = msg.rawHtml || (() => {
      let t = this._esc(msg.chatMessage);
      t = t.replace(/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?()[\]{}])/g,
        url => `<a href="${url}" target="_blank" rel="noopener" class="r20-link">${url}</a>`);
      return t.replace(/\n/g, '<br>');
    })();
    if (msg.attachedImage) {
      content += `<div class="bubble-img-wrap"><img class="bubble-img" src="${this._esc(msg.attachedImage)}" alt=""></div>`;
    }

    const avatarHtml = this._r20Avatar(profileUrl);
    const contrastFg = rowBg ? this._contrastColor(rowBg) : null;
    
    // [수정] Roll20 인라인 발언명 수정이 가능하도록 span 구조에 msg-name, contenteditable 부여
    const nameHtml = isFirstInGroup
      ? `<span class="r20-name-inline msg-name"${contrastFg ? ` style="color:${contrastFg}"` : ''} contenteditable="true" spellcheck="false" onclick="event.stopPropagation()">${this._esc(displayName)}: </span>`
      : '';
      
    const textStyle = contrastFg ? ` style="color:${contrastFg}"` : '';
    const contCls = isFirstInGroup ? '' : ' r20-cont';
    const leftEl  = isFirstInGroup
      ? avatarHtml
      : '<div class="r20-avatar r20-avatar-spacer"></div>';
    return `<div class="r20-msg r20-chat${contCls}${isMe ? ' r20-mine' : ''}" data-index="${i}"${rowStyle}>
  ${leftEl}
  <div class="r20-body" data-edit-body>
    <div class="r20-text"${textStyle}>${nameHtml}<span onclick="window.chatApp.startEdit(${i})">${content}</span></div>
  </div>
</div>`;
  }

  _r20Avatar(profileUrl) {
    if (profileUrl) {
      return `<div class="r20-avatar"><img src="${this._esc(profileUrl)}" alt=""></div>`;
    }
    return `<div class="r20-avatar r20-avatar-blank"></div>`;
  }

  _renderMessage(msg, index, isMe, displayName, profileUrl, bubbleColor, isFirst, isLast) {
    if (msg.isDesc) {
      const descContent = msg.rawHtml || this._esc(msg.chatMessage).replace(/\n/g,'<br>');
      return `<div class="chat-message other desc group-end" data-index="${index}">
  <div class="msg-avatar hidden"></div>
  <div class="msg-body" style="max-width:100%">
    <div class="bubble desc-bubble" onclick="window.chatApp.startEdit(${index})">${descContent}</div>
  </div>
</div>`;
    }
    if (!msg || !msg.username) return '';
    const cls = ['chat-message', isMe ? 'mine' : 'other'];
    if (!isFirst) cls.push('cont');
    if (isLast) cls.push('group-end');

    const hideMyAvatar = isMe && !this.app.state.showMyProfile;
    const showAvatar   = isFirst && !hideMyAvatar;
    const avatarInner  = showAvatar
      ? (profileUrl ? `<img src="${this._esc(profileUrl)}" alt="">` : '')
      : '';
    const avatarClass  = `msg-avatar${showAvatar ? '' : ' hidden'}`;

    const nameColor = this.app.state.userNameColors?.[msg.username] || null;
    const nameStyle = nameColor ? ` style="color:${nameColor}"` : '';
    
    // [수정] 일반 메신저형 프로필 이름 렌더링에 msg-name 클래스와 contenteditable 속성 주입
    const nameHtml = isFirst
      ? `<div class="msg-name msg-name"${nameStyle} contenteditable="true" spellcheck="false">${this._esc(displayName)}</div>` : '';

    let content;
    if (msg.rawHtml) {
      content = msg.rawHtml;
    } else {
      content = this._esc(msg.chatMessage);
      if (this.app.state.highlightTags) {
        content = content.replace(/@([^\s<]+)/g, '<span class="mention">@$1</span>');
      }
      content = content.replace(
        /(https?:\/\/[^\s<>"'\u3131-\u318E\uAC00-\uD7A3]+[^\s<>"'\u3131-\u318E\uAC00-\uD7A3.,;:!?()[\]{}])/g,
        url => `<a href="${url}" target="_blank" rel="noopener" class="chat-link">${url}</a>`
      );
      content = content.replace(/\n/g, '<br>');
    }
    if (msg.attachedImage) {
      content += `<div class="bubble-img-wrap"><img class="bubble-img" src="${this._esc(msg.attachedImage)}" alt=""></div>`;
    }

    let bubbleStyle = '';
    if (bubbleColor) {
      const fg = this._contrastColor(bubbleColor);
      bubbleStyle = `style="background:${bubbleColor};color:${fg};"`;
    }

    const timeHtml = isLast ? `<div class="msg-time">${this._esc(msg.time)}</div>` : '';

    return `<div class="${cls.join(' ')}" data-index="${index}" data-username="${this._esc(msg.username)}">
  <div class="${avatarClass}">${avatarInner}</div>
  <div class="msg-body">
    ${nameHtml}
    <div class="bubble"${bubbleStyle ? ' ' + bubbleStyle : ''} onclick="window.chatApp.startEdit(${index})">${content}</div>
  </div>
  ${timeHtml}
</div>`;
  }

  _groupMessages(messages) {
    const groups = [];
    let cur = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const key = `${msg.username}::${this._timeKey(msg.time)}`;

      if (!cur || cur.key !== key) {
        cur = { key, username: msg.username, messages: [] };
        groups.push(cur);
      }
      cur.messages.push({ index: i, message: msg });
    }
    return groups;
  }

  _timeKey(time) {
    const m = time.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+(오전|오후|AM|PM)\D+(\d{1,2}):(\d{2})/i);
    return m ? m.slice(1).join('-') : time;
  }

  // ── 프로필 카드 ──────────────────────────────────────────────

  renderProfileCards() {
    const grid = document.getElementById('profile-grid');
    if (!grid) return;

    const { messages, displayNames, selectedUsers, userProfileImages,
            userBubbleColors } = this.app.state;

    if (!messages?.length) { grid.innerHTML = ''; return; }

    const usernames = [...new Set(messages.map(m => m.username))];
    grid.innerHTML = '';

    for (const username of usernames) {
      const isMe = selectedUsers.has(username);
      const displayName = displayNames[username] || username;
      const profileUrl = userProfileImages[username] || null;
      const bubbleColor = userBubbleColors?.[username] || null;

      const row = document.createElement('div');
      const isHidden = (this.app.state.hiddenUsers || new Set()).has(username);
      row.className = `profile-row${isMe ? ' is-me' : ''}${isHidden ? ' is-hidden' : ''}`;
      row.dataset.username = username;

      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'profile-avatar-wrap';
      avatarWrap.title = '사진 변경';
      avatarWrap.innerHTML = profileUrl
        ? `<img src="${this._esc(profileUrl)}" alt="">`
        : `<div class="avatar-placeholder">${this._esc(this._avatarChar(displayName))}</div>`;
      avatarWrap.innerHTML += `<div class="avatar-upload-hint"><i class="fas fa-camera"></i></div>`;

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) this._handleImageUpload(username, file);
      });
      row.appendChild(fileInput);
      avatarWrap.addEventListener('click', () => fileInput.click());

      const infoCol = document.createElement('div');
      infoCol.className = 'profile-info-col';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'profile-name-input';
      nameInput.value = displayName;
      nameInput.addEventListener('change', e => {
        this.app.state.displayNames[username] = e.target.value.trim() || username;
        this._saveProfiles();
        this.renderMessages();
      });
      const origSpan = document.createElement('div');
      origSpan.className = 'profile-username';
      origSpan.textContent = username;
      infoCol.appendChild(nameInput);
      infoCol.appendChild(origSpan);

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'profile-select-cb';
      cb.dataset.username = username;
      cb.style.display = this._selectionMode ? 'flex' : 'none';
      row.appendChild(cb);

      const actions = document.createElement('div');
      actions.className = 'profile-row-actions';

      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.title = '말풍선 색상';
      swatch.style.background = bubbleColor || (isMe ? '#1a1a1a' : '#f0f0ee');
      swatch.addEventListener('click', e => this._openColorPicker(e, username, swatch));

      const meBtn = document.createElement('button');
      meBtn.className = 'me-toggle';
      meBtn.textContent = isMe ? '나' : '나로 설정';
      meBtn.addEventListener('click', () => this._toggleMe(username, row, meBtn, swatch));

      const resetBtn = document.createElement('button');
      resetBtn.className = 'profile-reset-btn';
      resetBtn.title = '이 프로필 초기화';
      resetBtn.innerHTML = '<i class="fas fa-undo"></i>';
      resetBtn.addEventListener('click', () => this.resetSingleProfile(username));

      const hideBtn = document.createElement('button');
      hideBtn.className = 'profile-hide-btn';
      hideBtn.title = isHidden ? '메시지 표시' : '메시지 숨기기';
      hideBtn.innerHTML = isHidden ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
      hideBtn.addEventListener('click', () => this._toggleHideUser(username, row, hideBtn));

      actions.appendChild(hideBtn);
      actions.appendChild(swatch);
      actions.appendChild(meBtn);
      actions.appendChild(resetBtn);

      row.appendChild(avatarWrap);
      row.appendChild(infoCol);
      row.appendChild(actions);
      grid.appendChild(row);
    }
  }

  // ── 프로필 선택 초기화 모드 ─────────────────────────────────

  _selectionMode = false;

  toggleProfileSelectionMode(enable) {
    this._selectionMode = enable;
    const grid = document.getElementById('profile-grid');
    if (!grid) return;

    grid.querySelectorAll('.profile-select-cb').forEach(cb => {
      cb.style.display = enable ? 'flex' : 'none';
      cb.checked = false;
    });
    grid.querySelectorAll('.profile-row').forEach(row => {
      row.classList.remove('selecting');
      if (enable) row.classList.add('selecting');
    });

    document.getElementById('select-mode-btn')?.style.setProperty('display', enable ? 'none' : '');
    const resetSelBtn = document.getElementById('reset-selected-btn');
    const cancelSelBtn = document.getElementById('cancel-select-btn');
    if (resetSelBtn) resetSelBtn.style.display = enable ? '' : 'none';
    if (cancelSelBtn) cancelSelBtn.style.display = enable ? '' : 'none';
  }

  resetSelectedProfiles() {
    const grid = document.getElementById('profile-grid');
    if (!grid) return;

    const checked = [...grid.querySelectorAll('.profile-select-cb:checked')];
    if (!checked.length) { this.showToast('선택된 프로필이 없습니다'); return; }

    if (!confirm(`${checked.length}개 프로필을 초기화할까요?`)) return;

    for (const cb of checked) {
      const username = cb.dataset.username;
      delete this.app.state.displayNames[username];
      if (this.app.state.userBubbleColors) delete this.app.state.userBubbleColors[username];
      if (this.app.state.userNameColors)   delete this.app.state.userNameColors[username];
      this.app.state.selectedUsers.delete(username);
      this.app.mediaManager.deleteProfileImage(username);
    }

    this._saveProfiles();
    this.toggleProfileSelectionMode(false);
    this.renderProfileCards();
    this.renderMessages();
    this.showToast(`${checked.length}개 프로필 초기화됨`);
  }

  resetSingleProfile(username) {
    if (!confirm(`'${this.app.state.displayNames[username] || username}' 프로필을 초기화할까요?`)) return;
    delete this.app.state.displayNames[username];
    if (this.app.state.userBubbleColors) delete this.app.state.userBubbleColors[username];
    if (this.app.state.userNameColors)   delete this.app.state.userNameColors[username];
    this.app.state.selectedUsers.delete(username);
    this.app.mediaManager.deleteProfileImage(username);
    this._saveProfiles();
    this.renderProfileCards();
    this.renderMessages();
    this.showToast('프로필 초기화됨');
  }

  _toggleHideUser(username, row, btn) {
    if (!this.app.state.hiddenUsers) this.app.state.hiddenUsers = new Set();
    const hidden = this.app.state.hiddenUsers;
    if (hidden.has(username)) {
      hidden.delete(username);
      row.classList.remove('is-hidden');
      btn.title = '메시지 숨기기';
      btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    } else {
      hidden.add(username);
      row.classList.add('is-hidden');
      btn.title = '메시지 표시';
      btn.innerHTML = '<i class="fas fa-eye"></i>';
    }
    this._saveProfiles();
    this.renderMessages();
  }

  _toggleMe(username, row, meBtn, swatch) {
    const sel = this.app.state.selectedUsers;
    if (sel.has(username)) {
      sel.delete(username);
      row.classList.remove('is-me');
      meBtn.textContent = '나로 설정';
    } else {
      sel.add(username);
      row.classList.add('is-me');
      meBtn.textContent = '나';
    }
    this._saveProfiles();
    this.renderMessages();
  }

  _openImageUpload(username) {
    const input = document.getElementById(`file-${this.app.dataManager.safeId(username)}`);
    if (input) input.click();
  }

  async _handleImageUpload(username, file) {
    try {
      this.toggleLoading(true, '이미지 처리 중...');
      const url = await this.app.mediaManager.setProfileImage(username, file);
      const row = document.querySelector(`[data-username="${CSS.escape(username)}"]`);
      if (row) {
        const wrap = row.querySelector('.profile-avatar-wrap');
        if (wrap) {
          wrap.innerHTML = `<img src="${url}" alt="">
            <div class="avatar-upload-hint"><i class="fas fa-camera"></i></div>`;
        }
      }
      this.renderProfileCards();
      this.renderMessages();
      this.showToast('프로필 이미지 변경됨');
    } catch (e) {
      alert('이미지 처리 실패: ' + e.message);
    } finally {
      this.toggleLoading(false);
    }
  }

  // ── 말풍선 / 이름 색상 피커 ──────────────────────────────────

  _openColorPicker(e, username, swatchEl) {
    e.stopPropagation();
    document.querySelectorAll('.color-picker-pop').forEach(p => p.remove());

    const curBubble = this.app.state.userBubbleColors?.[username] || null;
    const curName   = this.app.state.userNameColors?.[username]   || null;

    const pop = document.createElement('div');
    pop.className = 'color-picker-pop';

    const tabs = document.createElement('div');
    tabs.className = 'cpick-tabs';
    const tabBubble = document.createElement('button');
    tabBubble.className = 'cpick-tab active';
    tabBubble.textContent = '말풍선';
    const tabName = document.createElement('button');
    tabName.className = 'cpick-tab';
    tabName.textContent = '이름';
    tabs.appendChild(tabBubble);
    tabs.appendChild(tabName);
    pop.appendChild(tabs);

    const recentColors = this.app.state.recentColors || [];

    const makePanel = (currentColor, onApply, onReset) => {
      const panel = document.createElement('div');
      panel.className = 'cpick-panel';

      if (recentColors.length > 0) {
        const recentLabel = document.createElement('div');
        recentLabel.className = 'cpick-recent-label';
        recentLabel.textContent = '최근 사용';
        panel.appendChild(recentLabel);

        const recentRow = document.createElement('div');
        recentRow.className = 'cpick-recent-row';
        for (const rc of recentColors) {
          const rs = document.createElement('div');
          rs.className = 'cpick-recent-swatch';
          rs.style.background = rc;
          rs.title = rc;
          if (currentColor === rc) rs.style.borderColor = 'var(--accent)';
          rs.addEventListener('click', () => { onApply(rc); pop.remove(); });
          recentRow.appendChild(rs);
        }
        panel.appendChild(recentRow);
      }

      const grid = document.createElement('div');
      grid.className = 'color-swatches-grid';

      const noColor = document.createElement('div');
      noColor.className = 'color-preset color-preset-none';
      noColor.title = '색상 없음 (기본값)';
      noColor.textContent = '⊘';
      if (!currentColor) noColor.classList.add('selected');
      noColor.addEventListener('click', () => { onReset(); pop.remove(); });
      grid.appendChild(noColor);

      for (const color of this.COLOR_PRESETS) {
        const s = document.createElement('div');
        s.className = 'color-preset';
        s.style.background = color;
        if (currentColor === color) s.classList.add('selected');
        s.addEventListener('click', () => { onApply(color); pop.remove(); });
        grid.appendChild(s);
      }
      panel.appendChild(grid);

      const hexRow = document.createElement('div');
      hexRow.className = 'cpick-hex-row';
      const preview = document.createElement('div');
      preview.className = 'cpick-hex-preview';
      preview.style.background = currentColor || '#cccccc';
      const hexInput = document.createElement('input');
      hexInput.type = 'text';
      hexInput.className = 'cpick-hex-input';
      hexInput.placeholder = '#rrggbb';
      hexInput.maxLength = 7;
      hexInput.value = currentColor || '';
      hexInput.addEventListener('input', () => {
        let v = hexInput.value.trim();
        if (v && !v.startsWith('#')) { v = '#' + v; hexInput.value = v; }
        if (/^#[0-9a-fA-F]{6}$/.test(v)) preview.style.background = v;
      });
      hexInput.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
          const v = hexInput.value.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(v)) { onApply(v); pop.remove(); }
        }
      });
      const applyBtn = document.createElement('button');
      applyBtn.className = 'cpick-apply-btn';
      applyBtn.textContent = '적용';
      applyBtn.addEventListener('click', () => {
        const v = hexInput.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) { onApply(v); pop.remove(); }
      });
      hexRow.appendChild(preview);
      hexRow.appendChild(hexInput);
      hexRow.appendChild(applyBtn);
      panel.appendChild(hexRow);

      return panel;
    };

    const panelBubble = makePanel(
      curBubble,
      color => this._applyBubbleColor(username, color, swatchEl),
      ()    => this._applyBubbleColor(username, null, swatchEl)
    );
    const panelName = makePanel(
      curName,
      color => this._applyNameColor(username, color),
      ()    => this._applyNameColor(username, null)
    );
    panelName.style.display = 'none';

    pop.appendChild(panelBubble);
    pop.appendChild(panelName);

    tabBubble.addEventListener('click', () => {
      tabBubble.classList.add('active'); tabName.classList.remove('active');
      panelBubble.style.display = ''; panelName.style.display = 'none';
    });
    tabName.addEventListener('click', () => {
      tabName.classList.add('active'); tabBubble.classList.remove('active');
      panelName.style.display = ''; panelBubble.style.display = 'none';
    });

    const rect = swatchEl.getBoundingClientRect();
    document.body.appendChild(pop);
    const popH = pop.offsetHeight || 340;
    const topBelow = rect.bottom + 6;
    const topAbove = rect.top - popH - 6;
    const top = (topBelow + popH > window.innerHeight && topAbove > 0)
      ? topAbove : topBelow;
    pop.style.top  = Math.max(8, top) + 'px';
    pop.style.left = Math.max(8, Math.min(rect.left - 100, window.innerWidth - 270)) + 'px';

    const close = ev => {
      if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', close); }
    };
    setTimeout(() => document.addEventListener('click', close), 10);
  }

  _applyNameColor(username, color) {
    if (!this.app.state.userNameColors) this.app.state.userNameColors = {};
    if (color) {
      this.app.state.userNameColors[username] = color;
      this._addRecentColor(color);
    } else {
      delete this.app.state.userNameColors[username];
    }
    this._saveProfiles();
    this.renderMessages();
  }

  _applyBubbleColor(username, color, swatchEl) {
    if (!this.app.state.userBubbleColors) this.app.state.userBubbleColors = {};
    if (color) {
      this.app.state.userBubbleColors[username] = color;
      swatchEl.style.background = color;
      this._addRecentColor(color);
    } else {
      delete this.app.state.userBubbleColors[username];
      const isMe = this.app.state.selectedUsers.has(username);
      swatchEl.style.background = isMe ? '#1a1a1a' : '#f0f0ee';
    }
    this._saveProfiles();
    this.renderMessages();
  }

  // ── 최근 사용 색상 (최대 4개) ──────────────────────────────────
  _addRecentColor(color) {
    if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
    if (!this.app.state.recentColors) this.app.state.recentColors = [];
    const list = this.app.state.recentColors;
    const idx = list.indexOf(color);
    if (idx !== -1) list.splice(idx, 1);
    list.unshift(color);
    if (list.length > 4) list.length = 4;
    this.app.dataManager.saveSetting('recentColors', list);
  }

  // ── 명도 기반 글자색 ─────────────────────────────────────────

  _contrastColor(hex) {
    const c = hex.replace('#','');
    const r = parseInt(c.substr(0,2),16);
    const g = parseInt(c.substr(2,2),16);
    const b = parseInt(c.substr(4,2),16);
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.5 ? '#1a1a1a' : '#ffffff';
  }

  // ── 편집 인터페이스 ──────────────────────────────────────────

  createEditInterface(bubbleEl, currentText, index) {
    const msg = this.app.state.messages[index];
    if (!msg) { console.warn('createEditInterface: 메시지 없음', index); return; }

    const isContainerEdit = bubbleEl.classList.contains('r20-desc') ||
                            bubbleEl.classList.contains('r20-pill') ||
                            bubbleEl.hasAttribute('data-edit-body');
    const wrap = document.createElement('div');
    wrap.className = 'edit-wrap';
    wrap.addEventListener('click', e => e.stopPropagation());

    const r20CssEditEnabled = this.app.state.r20CssEditEnabled || false;
    const useRawHtml = !!msg.rawHtml && r20CssEditEnabled;
    const initialText = useRawHtml ? (msg.rawHtml || currentText) : currentText;

    const ta = document.createElement('textarea');
    ta.className = 'edit-textarea';
    ta.value = initialText;
    ta.rows = Math.max(4, Math.min(20, initialText.split('\n').length + 2));

    const imgPreviewWrap = document.createElement('div');
    imgPreviewWrap.className = 'edit-img-preview-wrap';
    imgPreviewWrap.style.display = 'none';

    let attachedImageData = msg.attachedImage || null;

    const updateImgPreview = () => {
      if (attachedImageData) {
        imgPreviewWrap.style.display = 'flex';
        imgPreviewWrap.innerHTML = `
          <img class="edit-img-preview" src="${attachedImageData}" alt="">
          <button class="edit-img-remove" title="이미지 제거">✕</button>`;
        imgPreviewWrap.querySelector('.edit-img-remove')
          .addEventListener('click', () => {
            attachedImageData = null;
            updateImgPreview();
          });
      } else {
        imgPreviewWrap.style.display = 'none';
        imgPreviewWrap.innerHTML = '';
      }
    };
    updateImgPreview();

    const actions = document.createElement('div');
    actions.className = 'edit-actions';

    const imgInput = document.createElement('input');
    imgInput.type = 'file';
    imgInput.accept = 'image/*';
    imgInput.style.display = 'none';
    imgInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        attachedImageData = ev.target.result;
        updateImgPreview();
      };
      reader.readAsDataURL(file);
    });

    const imgBtn = document.createElement('button');
    imgBtn.type = 'button';
    imgBtn.className = 'edit-btn edit-img-btn';
    imgBtn.innerHTML = '<i class="fas fa-image"></i>';
    imgBtn.title = '이미지 첨부';
    imgBtn.addEventListener('click', () => imgInput.click());

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'edit-btn edit-del-btn';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', () => this.app.deleteMessage(index));

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'edit-btn';
    cancelBtn.textContent = '취소';
    cancelBtn.addEventListener('click', () => this.app.cancelEdit());

    const cssToggleWrap = document.createElement('div');
    cssToggleWrap.style.display = 'none';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'edit-btn primary';
    saveBtn.textContent = '저장';
    saveBtn.addEventListener('click', () => {
      if (useRawHtml) {
        this.app.saveEditRaw(index, ta.value, attachedImageData);
      } else {
        this.app.saveEdit(index, ta.value, attachedImageData);
      }
    });

    const leftBtns = document.createElement('div');
    leftBtns.style.display = 'flex';
    leftBtns.style.gap = '4px';
    leftBtns.appendChild(imgBtn);
    leftBtns.appendChild(imgInput);
    leftBtns.appendChild(delBtn);
    leftBtns.appendChild(cssToggleWrap);

    const rightBtns = document.createElement('div');
    rightBtns.style.display = 'flex';
    rightBtns.style.gap = '4px';
    rightBtns.appendChild(cancelBtn);
    rightBtns.appendChild(saveBtn);

    actions.appendChild(leftBtns);
    actions.appendChild(rightBtns);

    wrap.appendChild(ta);
    wrap.appendChild(imgPreviewWrap);
    wrap.appendChild(actions);

    if (isContainerEdit) {
      bubbleEl._r20OriginalContent = bubbleEl.innerHTML;
      bubbleEl._r20OriginalOnclick = bubbleEl.onclick;
      bubbleEl.innerHTML = '';
      bubbleEl.onclick = null;
      bubbleEl.appendChild(wrap);
    } else {
      bubbleEl.replaceWith(wrap);
    }
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // ── 꾸미기 패널 ──────────────────────────────────────────────

  toggleDecorPanel() {
    const panel = document.getElementById('decor-panel');
    if (panel) panel.classList.toggle('open');
    const btn = document.getElementById('decor-btn');
    if (btn) btn.innerHTML = panel?.classList.contains('open')
      ? '<i class="fas fa-chevron-down"></i> 꾸미기'
      : '<i class="fas fa-chevron-up"></i> 꾸미기';
  }

  // ── 저장 헬퍼 ────────────────────────────────────────────────

  _saveProfiles() {
    this.app.dataManager.saveProfiles(
      this.app.state.displayNames,
      this.app.state.userColors,
      this.app.state.selectedUsers
    );
    this.app.dataManager.saveSetting('bubbleColors', this.app.state.userBubbleColors || {});
    this.app.dataManager.saveSetting('nameColors',   this.app.state.userNameColors   || {});
    this.app.dataManager.saveSetting('hiddenUsers',  [...(this.app.state.hiddenUsers  || [])]);
  }

  // ── 유틸 ────────────────────────────────────────────────────

  _avatarChar(name) {
    if (!name) return '?';
    const stripped = name
      .replace(/^(\s*[\[\(【<「『《〈][^\]\)】> Rog ]*[\]\)】>」』》〉]\s*)+/, '')
      .trim();
    return (stripped[0] || name[0] || '?').toUpperCase();
  }

  _esc(s) {
    return (s || '').toString()
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}
