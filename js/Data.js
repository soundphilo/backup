// js/Data.js — 데이터 관리 (파서 자동감지 + IndexedDB 프로필 저장)

const APP_VERSION = '2.0.0';
const DB_NAME = 'ChatBackupDB';
const DB_VERSION = 1;

class DataManager {
  constructor(app) {
    this.app = app;
    this._db = null;
    this._parsers = [
      new BandParser(),
      new KakaoParser(),
      new DiscordParser(),
      new Roll20Parser(),
    ];

    this.defaultSettings = {
      highlightTags: true,
      showMyProfile: true,
    };
  }

  // ── IndexedDB 초기화 ──────────────────────────────────────────

  async openDB() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'username' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  }

  async _dbGet(store, key) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async _dbPut(store, value) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async _dbDelete(store, key) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async _dbGetAll(store) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  // ── 설정 저장/불러오기 ────────────────────────────────────────

  async saveSetting(key, value) {
    try {
      await this._dbPut('settings', { key, value });
    } catch (e) {
      console.error('설정 저장 실패:', key, e);
    }
  }

  async loadSetting(key, defaultValue = null) {
    try {
      const row = await this._dbGet('settings', key);
      return row ? row.value : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }

  async saveThemePreference(isDark) { await this.saveSetting('theme', isDark ? 'dark' : 'light'); }
  async loadThemePreference() { return (await this.loadSetting('theme', 'light')) === 'dark'; }

  async saveTagHighlightSetting(v) { await this.saveSetting('highlightTags', v); }
  async loadTagHighlightSetting() { return await this.loadSetting('highlightTags', true); }

  async saveShowMyProfileSetting(v) { await this.saveSetting('showMyProfile', v); }
  async loadShowMyProfileSetting() { return await this.loadSetting('showMyProfile', true); }

  async saveFontSize(v) { await this.saveSetting('fontSize', v); }
  async loadFontSize() { return await this.loadSetting('fontSize', 16); }

  // ── 프로필 (이름/색상/내 메시지 여부) ────────────────────────

  async saveProfiles(displayNames, selectedUsers) {
    try {
      await this._dbPut('profiles', {
        key: 'main',
        displayNames: displayNames || {},
        selectedUsers: Array.from(selectedUsers || []),
      });
    } catch (e) {
      console.error('프로필 저장 실패:', e);
    }
  }

  async loadProfiles() {
    const result = {
      displayNames: {},
      selectedUsers: new Set(),
    };
    try {
      const row = await this._dbGet('profiles', 'main');
      if (row) {
        result.displayNames = row.displayNames || {};
        result.selectedUsers = new Set(row.selectedUsers || []);
      }
    } catch (e) {
      console.error('프로필 불러오기 실패:', e);
    }
    return result;
  }

  // ── 프로필 이미지 (Blob → IndexedDB) ─────────────────────────

  async saveProfileImage(username, blob) {
    try {
      await this._dbPut('images', { username, blob });
    } catch (e) {
      console.error('이미지 저장 실패:', username, e);
    }
  }

  async loadProfileImage(username) {
    try {
      const row = await this._dbGet('images', username);
      return row ? row.blob : null;
    } catch (e) {
      return null;
    }
  }

  async loadAllProfileImages() {
    try {
      return await this._dbGetAll('images'); // [{username, blob}, ...]
    } catch (e) {
      return [];
    }
  }

  async deleteProfileImage(username) {
    try {
      await this._dbDelete('images', username);
    } catch (e) {
      console.error('이미지 삭제 실패:', username, e);
    }
  }

  async resetAllData() {
    try {
      const db = await this.openDB();
      await Promise.all(['profiles', 'images', 'settings'].map(store =>
        new Promise((res, rej) => {
          const tx = db.transaction(store, 'readwrite');
          const req = tx.objectStore(store).clear();
          req.onsuccess = res;
          req.onerror = rej;
        })
      ));
    } catch (e) {
      console.error('데이터 초기화 실패:', e);
    }
  }

  // ── 파서 자동감지 + 파싱 ──────────────────────────────────────

  detectParser(text) {
    for (const parser of this._parsers) {
      if (parser.canParse(text)) return parser;
    }
    return null;
  }

  async parseMessages(chatData, forcePlatform = null) {
    if (!chatData || typeof chatData !== 'string') {
      throw new Error('유효하지 않은 채팅 데이터입니다.');
    }

    let parser;
    if (forcePlatform) {
      parser = this._parsers.find(p => p.name === forcePlatform) || null;
    }
    if (!parser) {
      parser = this.detectParser(chatData);
    }
    if (!parser) {
      throw new Error('채팅 형식을 인식할 수 없습니다.\n플랫폼을 직접 선택해주세요.');
    }

    // roll20은 비동기로 실행 (메인 스레드 순간 점유 방지 + 로딩 표시)
    let messages;
    if (parser.name === 'roll20') {
      messages = await this._parseRoll20Async(chatData, parser);
    } else {
      messages = parser.parse(chatData);
    }

    if (!messages.length) {
      throw new Error('파싱된 메시지가 없습니다. 내용을 확인해주세요.');
    }

    return { messages, platform: parser.name, platformLabel: parser.label };
  }

  // roll20 파싱: 정규식 기반 파서라 빠르지만
  // 로딩 표시 + 브라우저 이벤트 루프 한 틱 양보용 비동기 래퍼
  _parseRoll20Async(chatData, parser) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(parser.parse(chatData));
        } catch (err) {
          reject(err);
        }
      }, 0);
    });
  }

}