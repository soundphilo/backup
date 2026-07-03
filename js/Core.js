// js/Core.js — 앱 진입점, 이벤트 연결

const APP_MAX_USERS = 50;

class ChatBackupApp {
  constructor() {
    this.state = {
      messages: [],
      userProfileImages: {},
      userColors: {},
      userBubbleColors: {},
      userNameColors: {},
      hiddenUsers: new Set(),
      recentColors: [],
      r20CssEditEnabled: false,
      avatarShape: 'circle',
      displayNames: {},
      selectedUsers: new Set(),
      darkMode: false,
      highlightTags: true,
      showMyProfile: true,
      fontSize: 14,
      isProcessing: false,
      detectedPlatform: null,
    };

    this.dataManager   = null;
    this.mediaManager  = null;
    this.uiManager     = null;
    this.exportManager = null;
    this.editingIndex  = null;

    this._forcePlatform = null; // 수동 플랫폼 선택
    this._isNameBlurProcessing = false; // [추가] 리렌더링으로 인한 무한 blur 루프 방지 플래그
  }

  async init() {
    try {
      this.dataManager   = new DataManager(this);
      this.mediaManager  = new MediaManager(this);
      this.uiManager     = new UIManager(this);
      this.exportManager = new ExportManager(this);

      await this._loadSettings();
      await this.mediaManager.loadAllImages();

      this.uiManager.initTheme();
      this._bindEvents();
      this._syncToggles();

      console.log('ChatBackup v' + APP_VERSION + ' 초기화 완료');
    } catch (e) {
      console.error('초기화 오류:', e);
      alert('앱 초기화 중 오류가 발생했습니다. 페이지를 새로고침해주세요.');
    }
  }

  // ── 설정 로드 ──────────────────────────────────────────────

  async _loadSettings() {
    const profiles = await this.dataManager.loadProfiles();
    Object.assign(this.state, {
      displayNames:  profiles.displayNames,
      userColors:    profiles.userColors,
      selectedUsers: profiles.selectedUsers,
    });

    this.state.darkMode      = await this.dataManager.loadThemePreference();
    this.state.highlightTags = await this.dataManager.loadTagHighlightSetting();
    this.state.showMyProfile = await this.dataManager.loadShowMyProfileSetting();
    this.state.fontSize      = await this.dataManager.loadFontSize();

    const bubbleColors = await this.dataManager.loadSetting('bubbleColors', {});
    this.state.userBubbleColors = bubbleColors;

    const nameColors = await this.dataManager.loadSetting('nameColors', {});
    this.state.userNameColors = nameColors;

    const hiddenUsers = await this.dataManager.loadSetting('hiddenUsers', []);
    this.state.hiddenUsers = new Set(hiddenUsers);

    const recentColors = await this.dataManager.loadSetting('recentColors', []);
    this.state.recentColors = recentColors;

    const avatarShape = await this.dataManager.loadSetting('avatarShape', 'circle');
    this.state.avatarShape = avatarShape;
  }

  // ── 이벤트 바인딩 ─────────────────────────────────────────

  _bindEvents() {
    // 플랫폼 선택 알약
    document.querySelectorAll('.platform-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.platform-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const plat = pill.dataset.platform;
        this._forcePlatform = plat === 'auto' ? null : plat;

        // 강제 선택 후 현재 텍스트가 있으면 재분석
        const ta = document.getElementById('input-text');
        if (ta && ta.value.trim()) this._analyzeDebounced(ta.value);
      });
    });

    // 텍스트 입력 감지
    const ta = document.getElementById('input-text');
    if (ta) {
      let debounce;
      ta.addEventListener('input', () => {
        clearTimeout(debounce);
        const val = ta.value.trim();
        if (!val) { this.uiManager.clearDetectBadge(); return; }
        debounce = setTimeout(() => this._detectOnly(val), 400);
      });

      // 드래그 앤 드롭
      ta.addEventListener('dragover', e => { e.preventDefault(); ta.classList.add('drag-over'); });
      ta.addEventListener('dragleave', () => ta.classList.remove('drag-over'));
      ta.addEventListener('drop', e => {
        e.preventDefault();
        ta.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) this._handleFileLoad(file);
      });
    }

    // 분석 버튼
    document.getElementById('analyze-btn')?.addEventListener('click', () => {
      const val = document.getElementById('input-text')?.value.trim();
      if (val) this.handleAnalyze(val);
    });

    // 내보내기 버튼들
    document.getElementById('copy-btn')?.addEventListener('click', () =>
      this.exportManager.copyHtmlToClipboard());

    document.getElementById('download-html-btn')?.addEventListener('click', () =>
      this.exportManager.downloadHtmlFile());

    document.getElementById('download-txt-btn')?.addEventListener('click', () =>
      this.exportManager.downloadTxtFile());

    // 다운로드 드롭다운
    const dlBtn = document.getElementById('download-btn');
    const dlMenu = document.getElementById('download-menu');
    if (dlBtn && dlMenu) {
      dlBtn.addEventListener('click', e => {
        e.stopPropagation();
        dlMenu.classList.toggle('open');
      });
      document.addEventListener('click', () => dlMenu.classList.remove('open'));
    }

    // 초기화
    document.getElementById('clear-btn')?.addEventListener('click', () => {
      if (confirm('채팅 데이터를 지우시겠습니까?')) this.handleClear();
    });

    // 테마
    document.getElementById('theme-btn')?.addEventListener('click', () =>
      this.uiManager.toggleTheme());

    // 꾸미기 패널
    document.getElementById('decor-btn')?.addEventListener('click', () =>
      this.uiManager.toggleDecorPanel());

    // 글자 크기 슬라이더 (초기값은 _syncToggles에서)
    document.getElementById('font-size-slider')?.addEventListener('input', e => {
      const v = parseInt(e.target.value);
      this.state.fontSize = v;
      const fv = document.getElementById('font-size-value');
      if (fv) fv.textContent = v + 'px';
      const cc = document.getElementById('chat-container');
      if (cc) cc.style.fontSize = v + 'px';
      this.dataManager.saveFontSize(v);
    });

    // 태그 하이라이트 토글
    document.getElementById('highlight-tags-toggle')?.addEventListener('change', e => {
      this.state.highlightTags = e.target.checked;
      this.dataManager.saveTagHighlightSetting(this.state.highlightTags);
      if (this.state.messages.length) this.uiManager.renderMessages();
    });

    // 내 프로필 이미지 표시 토글
    const showMyProfileToggle = document.getElementById('show-my-profile-toggle');
    if (showMyProfileToggle) {
      showMyProfileToggle.checked = this.state.showMyProfile;
      showMyProfileToggle.addEventListener('change', e => {
        this.state.showMyProfile = e.target.checked;
        this.dataManager.saveShowMyProfileSetting(this.state.showMyProfile);
        if (this.state.messages.length) this.uiManager.renderMessages();
      });
    }

    // r20-css-enabled: 이벤트 위임으로 처리 (getElementById 타이밍 문제 방지)
    this.dataManager.loadSetting('r20CssEditEnabled', false).then(v => {
      this.state.r20CssEditEnabled = !!v;
      const el = document.getElementById('r20-css-enabled');
      if (el) el.checked = !!v;
    });
    // document 레벨에서 버블링으로 잡음 — DOM 재생성돼도 항상 동작
    document.addEventListener('change', e => {
      if (e.target && e.target.id === 'r20-css-enabled') {
        this.state.r20CssEditEnabled = e.target.checked;
        this.dataManager.saveSetting('r20CssEditEnabled', e.target.checked);
        if (this.editingIndex !== null) this.cancelEdit();
      }
    });

    // 아바타 모양
    document.querySelectorAll('.avatar-shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.avatar-shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const shape = btn.dataset.shape;
        this.state.avatarShape = shape;
        this.dataManager.saveSetting('avatarShape', shape);
        // chat-container에 클래스 반영
        const cc = document.getElementById('chat-container');
        if (cc) {
          cc.classList.remove('avatar-circle', 'avatar-rounded', 'avatar-square');
          cc.classList.add(`avatar-${shape}`);
        }
        if (this.state.messages.length) this.uiManager.renderMessages();
      });
    });

    // ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.editingIndex !== null) this.cancelEdit();
    });

    // 페이지 언로드 시 Object URL 해제
    window.addEventListener('beforeunload', () => this.mediaManager.revokeAll());

    // ── 미리보기 창 닉네임 개별 수정 및 데이터/UI 완전히 동기화 ──────────────────
    
    // 1. 미리보기 창의 닉네임을 편집하고 포커스가 빠질 때(blur) 확실하게 데이터 원본 변경
    document.addEventListener('blur', e => {
      if (e.target && e.target.classList.contains('msg-name')) {
        // [안전장치] 리렌더링으로 인해 연속 blur가 잡히는 무한 루프를 원천 차단합니다.
        if (window.chatApp._isNameBlurProcessing) return;

        const updatedName = e.target.innerText.trim();
        
        // 부모 요소를 찾아 변경할 메시지의 고유 인덱스(index)를 가져옵니다.
        const msgContainer = e.target.closest('[data-index]');
        if (!msgContainer) return;
        
        const index = parseInt(msgContainer.getAttribute('data-index'), 10);
        if (isNaN(index) || !window.chatApp.state.messages[index]) return;

        // 아무것도 안 적고 나갔다면 원래 이름으로 원상 복구
        if (!updatedName) {
          e.target.innerText = window.chatApp.state.messages[index].username;
          return;
        }

        // 플래그 가동 (렌더링 도중 발생하는 자동 blur 무시 목적)
        window.chatApp._isNameBlurProcessing = true;

        // [구조 수정] window.chatApp 인스턴스를 직접 명시하여 고정합니다.
        window.chatApp.state.messages[index].username = updatedName;
        msgContainer.setAttribute('data-username', updatedName);

        // Roll20 플랫폼 특화 구조 치환 로직
        if (window.chatApp.state.detectedPlatform === 'roll20' && window.chatApp.state.messages[index].rawHtml) {
          let raw = window.chatApp.state.messages[index].rawHtml;
          raw = raw.replace(/(class="[^"]*msg-name[^"]*"[^>]*>)(.*?)(<\/)/g, `$1${updatedName}$3`);
          raw = raw.replace(/([^\s<>"':]+)(:\s*<\/span>)/g, `${updatedName}$2`);
          window.chatApp.state.messages[index].rawHtml = raw;
          if (window.chatApp.state.messages[index].chatMessage === window.chatApp.state.messages[index].rawHtml) {
            window.chatApp.state.messages[index].chatMessage = raw;
          }
        }

        console.log(`[동기화 완료] 인덱스 ${index}번 메시지 유저명이 '${updatedName}'으로 고정되었습니다.`);

        // 프로필 데이터 세이브 및 전면 새로고침 체인 가동
        window.chatApp.uiManager._saveProfiles();      
        window.chatApp.uiManager.renderProfileCards(); 
        window.chatApp.uiManager.renderMessages();     

        // 처리가 완벽히 끝난 후 안전장치 해제
        setTimeout(() => {
          window.chatApp._isNameBlurProcessing = false;
        }, 50);
      }
    }, true); // 캡처링 유지

    // 2. 닉네임 수정 중 엔터를 치면 줄바꿈되지 않고 즉시 반영 처리
    document.addEventListener('keydown', e => {
      if (e.target && e.target.classList.contains('msg-name')) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        }
      }
    });
  }

  _syncToggles() {
    // 아바타 모양 버튼 동기화
    const shape = this.state.avatarShape || 'circle';
    document.querySelectorAll('.avatar-shape-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.shape === shape);
    });
    const cc = document.getElementById('chat-container');
    if (cc) {
      cc.classList.remove('avatar-circle', 'avatar-rounded', 'avatar-square');
      cc.classList.add(`avatar-${shape}`);
    }

    const hl = document.getElementById('highlight-tags-toggle');
    if (hl) hl.checked = this.state.highlightTags;

    const smp = document.getElementById('show-my-profile-toggle');
    if (smp) smp.checked = this.state.showMyProfile;

    const fs = document.getElementById('font-size-slider');
    if (fs) {
      fs.value = this.state.fontSize;
      const fv = document.getElementById('font-size-value');
      if (fv) fv.textContent = this.state.fontSize + 'px';
    }
  }

  // ── 분석 (감지만, 렌더링 없음) ───────────────────────────────

  _detectOnly(text) {
    const parser = this.dataManager.detectParser(text);
    if (parser) {
      this.uiManager.updateDetectBadge(parser.name, '—');
    } else {
      this.uiManager.clearDetectBadge();
    }
  }

  _analyzeDebounced(text) {
    clearTimeout(this._aDb);
    this._aDb = setTimeout(() => this.handleAnalyze(text, true), 0);
  }

  // ── 분석 + 렌더링 ────────────────────────────────────────────

  async handleAnalyze(text, silent = false) {
    if (this.state.isProcessing) return;
    if (!text) { alert('채팅 데이터를 입력해주세요.'); return; }

    this.state.isProcessing = true;
    if (!silent) this.uiManager.toggleLoading(true, '분석 중...');

    try {
      const { messages, platform, platformLabel } =
        await this.dataManager.parseMessages(text, this._forcePlatform);

      const users = new Set(messages.map(m => m.username));
      if (users.size > APP_MAX_USERS) {
        alert(`참여자가 ${users.size}명입니다. 최대 ${APP_MAX_USERS}명까지 지원합니다.`);
        this.state.isProcessing = false;
        if (!silent) this.uiManager.toggleLoading(false);
        return;
      }

      this.state.messages = messages;
      this.state.detectedPlatform = platform;

      // 롤20: avatarUrl → fetch → Blob → IndexedDB 저장
      if (platform === 'roll20') {
        const avatarJobs = [];
        const seen = new Set();
        for (const msg of messages) {
          if (!msg.avatarUrl || !msg.username || seen.has(msg.username)) continue;
          seen.add(msg.username);
          if (this.state.userProfileImages[msg.username]) continue;
          const url = msg.avatarUrl, uname = msg.username;
          avatarJobs.push((async () => {
            try {
              const resp = await fetch(url);
              if (!resp.ok) return;
              const blob = await resp.blob();
              const objectUrl = await this.mediaManager.setProfileImage(uname, blob);
              if (objectUrl) this.state.userProfileImages[uname] = objectUrl;
            } catch { /* 무시 */ }
          })());
        }
        if (avatarJobs.length) {
          Promise.allSettled(avatarJobs).then(() => {
            this.uiManager.renderProfileCards();
            this.uiManager.renderMessages();
          });
        }
      }

      this._updatePlatformPill(platform);
      this.uiManager.updateDetectBadge(platform, messages.length);
      this.uiManager.renderProfileCards();
      this.uiManager.renderMessages();
    } catch (e) {
      if (!silent) alert(e.message);
      else this.uiManager.updateDetectBadge(null, 0);
    } finally {
      this.state.isProcessing = false;
      this.uiManager.toggleLoading(false);
    }
  }

  _updatePlatformPill(platform) {
    const r20Row = document.getElementById('r20-css-row');
    if (r20Row) r20Row.style.display = (platform === 'roll20') ? '' : 'none';

    if (this._forcePlatform) return;
    document.querySelectorAll('.platform-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.platform === (platform || 'auto'));
    });
  }

  // ── 파일 로드 ────────────────────────────────────────────────

  async _handleFileLoad(file) {
    if (!file.name.endsWith('.txt') && file.type !== 'text/plain') {
      alert('텍스트 파일(.txt)만 지원합니다.');
      return;
    }
    try {
      let text = await file.text();
      if (text.includes('\ufffd') || /[\u00c0-\u00ff]{3,}/.test(text.slice(0,200))) {
        try {
          const buf = await file.arrayBuffer();
          text = new TextDecoder('euc-kr').decode(buf);
        } catch { }
      }
      const ta = document.getElementById('input-text');
      if (ta) {
        const SIZE_LIMIT = 500 * 1024;
        if (text.length > SIZE_LIMIT) {
          const kb = Math.round(text.length / 1024);
          ta.value = '';
          ta.placeholder = `📄 ${file.name} (${kb}KB) — 파일이 로드됐습니다. 분석을 누르세요.`;
          this._pendingLargeText = text;
        } else {
          ta.value = text;
          this._pendingLargeText = null;
        }
      }
      await this.handleAnalyze(text);
    } catch (e) {
      alert('파일 읽기 실패: ' + e.message);
    }
  }

  // ── 편집 ────────────────────────────────────────────────────

  startEdit(index) {
    if (index < 0 || index >= this.state.messages.length) return;
    if (this.editingIndex !== null) this.cancelEdit();

    const container = document.querySelector(`[data-index="${index}"]`);
    if (!container) return;

    let msgEl;
    if (container.classList.contains('r20-desc') || container.classList.contains('r20-pill')) {
      msgEl = container;
    } else {
      msgEl = container.querySelector('[data-edit-body], .bubble, .r20-roll-wrap');
    }
    if (!msgEl) return;

    this.editingIndex = index;
    const m = this.state.messages[index];
    const editText = (m.rawHtml && this.state.r20CssEditEnabled) ? m.rawHtml : m.chatMessage;
    this.uiManager.createEditInterface(msgEl, editText, index);
  }

  saveEditRaw(index, newHtml, attachedImage) {
    if (newHtml && newHtml.trim()) {
      this.state.messages[index].rawHtml     = newHtml.trim();
      this.state.messages[index].chatMessage = newHtml.trim();
    }
    if (attachedImage !== undefined) {
      this.state.messages[index].attachedImage = attachedImage || null;
    }
    this.editingIndex = null;
    this.uiManager.renderMessages();
  }

  saveEdit(index, newText, attachedImage) {
    if (newText && newText.trim()) {
      this.state.messages[index].chatMessage = newText.trim();
    }
    if (attachedImage !== undefined) {
      this.state.messages[index].attachedImage = attachedImage || null;
    }
    this.editingIndex = null;
    this.uiManager.renderMessages();
  }

  cancelEdit() {
    this.editingIndex = null;
    this.uiManager.renderMessages();
  }

  deleteMessage(index) {
    if (confirm('이 메시지를 삭제하시겠습니까?')) {
      this.state.messages.splice(index, 1);
      this.editingIndex = null;
      this.uiManager.renderMessages();
    } else {
      this.cancelEdit();
    }
  }

  // ── 초기화 ──────────────────────────────────────────────────

  handleClear() {
    const ta = document.getElementById('input-text');
    if (ta) ta.value = '';
    this.state.messages = [];
    this.state.detectedPlatform = null;
    this.editingIndex = null;
    this.uiManager.clearDetectBadge();
    this.uiManager.renderMessages();
    this.uiManager.renderProfileCards();
  }
}

// ── 부트스트랩 ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  window.chatApp = new ChatBackupApp();
  await window.chatApp.init();

  // 전역 호환 함수
  window.startEdit = i => window.chatApp.startEdit(i);
});
