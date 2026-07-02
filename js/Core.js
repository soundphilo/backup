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
      // 각 username에 대해 중복 없이 한 번만, 완료 후 렌더링 갱신
      if (platform === 'roll20') {
        const avatarJobs = [];
        const seen = new Set();
        for (const msg of messages) {
          if (!msg.avatarUrl || !msg.username || seen.has(msg.username)) continue;
          seen.add(msg.username);
          // 이미 IndexedDB에서 불러온 이미지가 있으면 덮어쓰지 않음
          if (this.state.userProfileImages[msg.username]) continue;
          const url = msg.avatarUrl, uname = msg.username;
          avatarJobs.push((async () => {
            try {
              const resp = await fetch(url);
              if (!resp.ok) return;
              const blob = await resp.blob();
              const objectUrl = await this.mediaManager.setProfileImage(uname, blob);
              if (objectUrl) this.state.userProfileImages[uname] = objectUrl;
            } catch { /* CORS 등 실패 시 무시 */ }
          })());
        }
        // 모든 fetch 완료 후 렌더링 갱신 (비동기, 메인 렌더링 블로킹 없음)
        if (avatarJobs.length) {
          Promise.allSettled(avatarJobs).then(() => {
            this.uiManager.renderProfileCards();
            this.uiManager.renderMessages();
          });
        }
      }

      // 플랫폼 알약 자동 선택
      this._updatePlatformPill(platform);
      this.uiManager.updateDetectBadge(platform, messages.length);
      this.uiManager.renderProfileCards();
      this.uiManager.renderMessages();
    } catch (e) {
      if (!silent) alert(e.message);
      else this.uiManager.updateDetectBadge(null, 0);
    } finally {
      this.state.isProcessing = false;
      this.uiManager.toggleLoading(false); // silent 여부 관계없이 항상 끔
    }
  }

  _updatePlatformPill(platform) {
    // 롤20 CSS 편집 행 표시/숨김 (forcePlatform 여부 관계없이 항상)
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
      // UTF-8 먼저 시도, 깨지면 EUC-KR로 재시도
      let text = await file.text();
      if (text.includes('\ufffd') || /[\u00c0-\u00ff]{3,}/.test(text.slice(0,200))) {
        try {
          const buf = await file.arrayBuffer();
          text = new TextDecoder('euc-kr').decode(buf);
        } catch { /* UTF-8 유지 */ }
      }
      const ta = document.getElementById('input-text');
      if (ta) {
        // 500KB 초과 시 textarea에 직접 박지 않음 (렌더링 부하 방지)
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

    // .r20-desc / .r20-pill 은 container 자체가 편집 대상
    let msgEl;
    if (container.classList.contains('r20-desc') || container.classList.contains('r20-pill')) {
      msgEl = container;
    } else {
      msgEl = container.querySelector('[data-edit-body], .bubble, .r20-roll-wrap');
    }
    if (!msgEl) return;

    this.editingIndex = index;
    const m = this.state.messages[index];
    // CSS 편집 모드면 rawHtml, 아니면 chatMessage 전달
    const editText = (m.rawHtml && this.state.r20CssEditEnabled)
      ? m.rawHtml
      : m.chatMessage;
    this.uiManager.createEditInterface(msgEl, editText, index);
  }

  // rawHtml 직접 편집 저장
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
      this.uiManager.renderMessages(); // editingIndex=null이므로 편집창 없이 렌더링
    }
    // 취소 시: cancelEdit으로 편집창 닫기
    else {
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