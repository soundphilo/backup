// js/Media.js — 이미지 처리 (IndexedDB + Object URL, 압축 없음)

class MediaManager {
  constructor(app) {
    this.app = app;
    // username → object URL 캐시 (메모리)
    this._urlCache = new Map();
  }

  // 이미지 파일 → Blob → IndexedDB 저장 + Object URL 반환
  async setProfileImage(username, file) {
    try {
      const blob = await this._resizeImage(file, 150, 0.85);
      await this.app.dataManager.saveProfileImage(username, blob);

      // 기존 캐시 URL 해제
      this._revokeUrl(username);

      const url = URL.createObjectURL(blob);
      this._urlCache.set(username, url);
      this.app.state.userProfileImages[username] = url;
      return url;
    } catch (e) {
      console.error('프로필 이미지 설정 실패:', e);
      throw e;
    }
  }

  // IndexedDB에서 모든 이미지 불러와 Object URL 생성
  async loadAllImages() {
    try {
      const rows = await this.app.dataManager.loadAllProfileImages();
      for (const { username, blob } of rows) {
        this._revokeUrl(username);
        const url = URL.createObjectURL(blob);
        this._urlCache.set(username, url);
        this.app.state.userProfileImages[username] = url;
      }
    } catch (e) {
      console.error('이미지 불러오기 실패:', e);
    }
  }

  // 특정 유저 이미지 삭제
  async deleteProfileImage(username) {
    this._revokeUrl(username);
    delete this.app.state.userProfileImages[username];
    await this.app.dataManager.deleteProfileImage(username);
  }

  // Object URL 전부 해제 (페이지 언로드 시)
  revokeAll() {
    for (const [username, url] of this._urlCache) {
      URL.revokeObjectURL(url);
    }
    this._urlCache.clear();
  }

  // 이미지 리사이즈 (canvas)
  _resizeImage(file, maxSize = 150, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = e => { img.src = e.target.result; };
      reader.onerror = reject;

      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round(height * maxSize / width);
            width = maxSize;
          } else {
            width = Math.round(width * maxSize / height);
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('변환 실패')),
          'image/webp',
          quality
        );
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Export용: Blob → base64 data URL
  async getBlobAsDataUrl(username) {
    try {
      const blob = await this.app.dataManager.loadProfileImage(username);
      if (!blob) return null;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  _revokeUrl(username) {
    const old = this._urlCache.get(username);
    if (old) { URL.revokeObjectURL(old); this._urlCache.delete(username); }
  }
}