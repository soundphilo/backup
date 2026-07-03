// js/Export.js — HTML/TXT 내보내기

class ExportManager {
  constructor(app) {
    this.app = app;
  }

  // ── HTML 생성 ────────────────────────────────────────────────

  async _buildHtml(forClipboard = false) {
    const { messages, displayNames, selectedUsers,
            userProfileImages, highlightTags, fontSize,
            userBubbleColors, userNameColors, showMyProfile } = this.app.state;

    if (!messages || !messages.length) throw new Error('변환할 메시지가 없습니다.');

    // Roll20 전용 내보내기
    if (this.app.state.detectedPlatform === 'roll20') {
      return this._buildHtmlR20(forClipboard);
    }

    // 이미지를 base64로 변환 — 현재 채팅방 참여자만
    const chatUsernames = new Set((messages||[]).map(m => m.username));
    const imageMap = {};
    if (this.app.mediaManager) {
      for (const username of Object.keys(userProfileImages)) {
        if (!chatUsernames.has(username)) continue;
        const dataUrl = await this.app.mediaManager.getBlobAsDataUrl(username);
        if (dataUrl) imageMap[username] = dataUrl;
      }
    }
    const escHtml = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // CSS 변수 기반 스타일 (다크모드 포함)
    // 아바타 CSS: username → 숫자 인덱스 기반 클래스 (한글 충돌 방지)
    const userIndexMap = {};
    let userIndexCounter = 0;
    const getAvCls = (username) => {
      if (userIndexMap[username] === undefined) userIndexMap[username] = userIndexCounter++;
      return 'av-' + userIndexMap[username];
    };
    const getAvIdx = getAvCls; // _buildHtml 내부 별칭
    const avatarCss = Object.entries(imageMap).map(([username, dataUrl]) => {
      const cls = getAvCls(username);
      return `.${cls}{background-image:url("${dataUrl}");background-size:cover;background-position:center;background-color:transparent}`;
    }).join('\n');

    const css = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#eceae8;padding:20px;font-size:${fontSize || 14}px}
.chat{max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:2px}
.msg{display:flex;align-items:flex-start;gap:8px;margin-bottom:2px}
.msg.mine{flex-direction:row-reverse}
.msg.ge{margin-bottom:12px}
.av{width:32px;height:32px;border-radius:50%;background:#e0e0de;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#555;margin-top:19px}.cont .av{margin-top:0}
.av img{width:100%;height:100%;object-fit:cover}
.av.h{visibility:hidden}
.msg-body{display:flex;flex-direction:column;max-width:60%;gap:1px}
.mine .msg-body{align-items:flex-end}
.nm{font-size:11px;font-weight:500;color:#999;margin-bottom:3px;padding:0 4px}.mine .nm{text-align:right}
.bl{padding:8px 13px;border-radius:18px;word-break:break-word;font-size:inherit;line-height:1.5}
.other .bl{background:#e8e8e6;color:#1a1a1a;border-radius:4px 18px 18px 18px}
.mine .bl{background:#1a1a1a;color:#fff;border-radius:18px 4px 18px 18px}
.cont.other .bl{border-radius:4px 18px 18px 4px}
.cont.mine .bl{border-radius:18px 4px 4px 18px}
.ge.other .bl{border-radius:4px 18px 18px 18px}
.ge.mine .bl{border-radius:18px 4px 18px 18px}
.tm{font-size:10px;color:#bbb;padding:0 4px;align-self:flex-end;flex-shrink:0}
.mention{color:#3b82f6;font-weight:500}
\n${avatarCss}`.trim();

    // hiddenUsers 필터링
    const hiddenUsers = this.app.state.hiddenUsers || new Set();
    const visibleMessages = messages.filter(m => !hiddenUsers.has(m.username));
    if (!visibleMessages.length) throw new Error('표시할 메시지가 없습니다.');

    // 그룹화
    const groups = this._groupMessages(visibleMessages);
    const lines = [];

    for (const group of groups) {
      for (let i = 0; i < group.messages.length; i++) {
        const { index, message } = group.messages[i];
        const isFirst = i === 0;
        const isLast = i === group.messages.length - 1;
        const isMe = selectedUsers.has(message.username);
        const displayName = displayNames[message.username] || message.username;
        const customColor = userBubbleColors?.[message.username] || null;
        const bubbleColor = customColor || (isMe ? '#1a1a1a' : null);
        const fgColor = bubbleColor ? this._contrastColor(bubbleColor) : null;
        const bubbleStyle = bubbleColor
          ? `background:${bubbleColor};${fgColor ? 'color:' + fgColor + ';' : ''}`
          : '';

        const imgSrc = imageMap[message.username];
        const avClsMain = getAvIdx(message.username || '');
        const avatarContent = imgSrc
          ? ''  // CSS background으로 처리
          : `<span>${escHtml(this._avatarChar(displayName))}</span>`;

        const hideMyAv = isMe && !showMyProfile;
        const avatarClass = `av${(!isFirst || hideMyAv) ? ' h' : ''}${imgSrc ? ' ' + avClsMain : ''}`;
        const msgClass = [
          'msg',
          isMe ? 'mine' : 'other',
          !isFirst ? 'cont' : '',
          isLast ? 'ge' : '',
        ].filter(Boolean).join(' ');

        const nameColor = userNameColors?.[message.username] || null;
        const nameHtml = isFirst ? `<div class="nm"${nameColor ? ' style="color:' + nameColor + '"' : ''}>${escHtml(displayName)}</div>` : '';

        let text = escHtml(message.chatMessage);
        if (highlightTags) {
          text = text.replace(/@([^\s<]+)/g, '<span class="mention">@$1</span>');
        }
        // URL → 클릭 가능 링크
        text = text.replace(
          /(https?:\/\/[^\s<>"'\u3131-\u318E\uAC00-\uD7A3]+[^\s<>"'\u3131-\u318E\uAC00-\uD7A3.,;:!?()[\]{}])/g,
          url => `<a href="${url}" target="_blank" rel="noopener" style="color:#3b82f6;word-break:break-all">${url}</a>`
        );
        text = text.replace(/\n/g, '<br>');

        // 첨부 이미지
        if (message.attachedImage) {
          text += `<div style="margin-top:6px"><img src="${escHtml(message.attachedImage)}" style="max-width:220px;border-radius:8px;display:block" alt=""></div>`;
        }

        const timeHtml = isLast ? `<div class="tm">${escHtml(message.time)}</div>` : '';

        lines.push(`<div class="${msgClass}">
  <div class="${avatarClass}">${avatarContent}</div>
  <div class="msg-body">
    ${nameHtml}
    <div class="bl"${bubbleStyle ? ' style="' + bubbleStyle + '"' : ''} >${text}</div>
  </div>
  ${timeHtml}
</div>`);
      }
    }

    const fullCss = css;
    if (forClipboard) {
      return `<style>${fullCss}</style><div class="chat">${lines.join('\n')}</div>`;
    }

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>채팅 백업</title>
<style>${fullCss}</style>
</head>
<body>
<div class="chat">
${lines.join('\n')}
</div>
</body>
</html>`;
  }


  // ── Roll20 전용 HTML 빌더 ────────────────────────────────────
  async _buildHtmlR20(forClipboard = false) {
    const { messages, displayNames, selectedUsers,
            userProfileImages, userBubbleColors, fontSize, avatarShape } = this.app.state;

    const escHtml = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // 프로필 이미지 base64 변환 — 현재 채팅방 참여자만
    const chatUsernames = new Set((messages||[]).map(m => m.username));
    const imageMap = {};
    if (this.app.mediaManager) {
      for (const username of Object.keys(userProfileImages)) {
        if (!chatUsernames.has(username)) continue;
        const dataUrl = await this.app.mediaManager.getBlobAsDataUrl(username);
        if (dataUrl) imageMap[username] = dataUrl;
      }
    }

    const hiddenUsers = this.app.state.hiddenUsers || new Set();
    const visibleMessages = messages.filter(m => !hiddenUsers.has(m.username));
    if (!visibleMessages.length) throw new Error('표시할 메시지가 없습니다.');

    // 아바타 CSS: username → 숫자 인덱스 기반 클래스 (한글 충돌 방지)
    const userIndexMap = {};
    let userIndexCounter = 0;
    const getAvCls = (username) => {
      if (userIndexMap[username] === undefined) userIndexMap[username] = userIndexCounter++;
      return 'av-' + userIndexMap[username];
    };
    const avatarCss = Object.entries(imageMap).map(([username, dataUrl]) => {
      const cls = getAvCls(username);
      return `.${cls}{background-image:url("${dataUrl}");background-size:cover;background-position:center;background-color:transparent}`;
    }).join('\n');

    const avatarRadius = avatarShape === 'circle' ? '50%' : avatarShape === 'rounded' ? '8px' : '2px';
    const css = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#f0f0f0;font-size:${fontSize||14}px;line-height:1.5}
.r20-wrap{max-width:900px;margin:0 auto}
.r20-msg{padding:4px 10px;border-bottom:1px solid rgba(0,0,0,0.05);font-size:inherit}
.r20-desc{text-align:center;color:#444;font-style:italic;font-size:inherit;padding:6px 20px;background:#f8f8f8;border-bottom:1px solid #eee}
.r20-pill{text-align:center;padding:6px 10px;background:transparent}
.r20-chat{display:flex;align-items:center;gap:8px;padding:4px 10px;background:#fff}
.r20-mine{background:#dce8f5}
.r20-avatar{width:36px;height:36px;flex-shrink:0;align-self:flex-start;border-radius:${avatarRadius};background:transparent;overflow:hidden}
.r20-avatar img{width:100%;height:100%;object-fit:cover}
.r20-body{flex:1;min-width:0}
.r20-name-inline{font-size:1em;font-weight:700;color:#555;margin-right:3px}
.r20-mine .r20-name-inline{color:#2a5f8f}
.r20-text{color:#1a1a1a;word-break:break-word;font-size:inherit}
.r20-roll-wrap{display:block;margin-top:2px}
.r20-link{color:#4a90d9;text-decoration:underline;word-break:break-all}
/* CoC 주사위 */
.r20-roll{background:#2a2a2a;border-radius:8px;overflow:hidden;min-width:180px;max-width:280px;font-size:inherit}
.r20-roll-caption{background:#1a1a1a;color:#fff;text-align:center;padding:6px 12px;font-weight:600}
.r20-roll-row{display:flex;justify-content:space-between;align-items:center;padding:5px 12px;border-bottom:1px solid #3a3a3a;color:#ddd}
.r20-roll-label{color:#aaa;font-size:0.85em}
.r20-roll-val{color:#fff;font-weight:500}
.r20-roll-num{background:#333;color:#fff;padding:2px 8px;border-radius:4px;font-weight:700;font-size:1em}
.r20-crit{background:#ffd700;color:#000}
.r20-roll-result{text-align:center;padding:7px 12px;color:#fff;font-weight:700;font-size:inherit}
.r20-inline-roll{display:inline-block;background:#3a3a3a;color:#fff;padding:1px 7px;border-radius:4px;font-weight:700;font-size:inherit;margin:0 2px}
.r20-roll-msg{align-items:flex-start!important}
.r20-cont{padding-top:0!important;padding-bottom:0!important;align-items:center}
.r20-cont .r20-avatar-spacer{width:36px;height:0;flex-shrink:0;visibility:hidden}
\n${avatarCss}`.trim();

    const lines = [];

    for (let vi = 0; vi < visibleMessages.length; vi++) {
      const msg = visibleMessages[vi];
      const isMe = selectedUsers.has(msg.username);
      const displayName = displayNames[msg.username] || msg.username;
      const imgSrc = imageMap[msg.username];

      // 연속 메시지 판단 (desc/pill/roll은 항상 그룹 끊음)
      const prev = visibleMessages[vi - 1];
      const isFirstInGroup = !prev
        || prev.username !== msg.username
        || prev.isDesc || msg.isDesc
        || (prev.rawHtml && prev.rawHtml.includes('linear-gradient'))
        || (msg.rawHtml && msg.rawHtml.includes('linear-gradient'))
        || prev.msgType === 'roll' || msg.msgType === 'roll';

      // ── desc ──────────────────────────────────────────────────
      if (msg.isDesc) {
        let content = msg.rawHtml || escHtml(msg.chatMessage);
        if (msg.attachedImage) {
          content += `<div style="margin-top:6px;text-align:center"><img src="${escHtml(msg.attachedImage)}" style="max-width:100%;max-height:300px;border-radius:6px;display:inline-block" alt=""></div>`;
        }
        lines.push(`<div class="r20-msg r20-desc">${content}</div>`);
        continue;
      }

      // ── pill ──────────────────────────────────────────────────
      if (msg.rawHtml && msg.rawHtml.includes('linear-gradient')) {
        lines.push(`<div class="r20-msg r20-pill">${msg.rawHtml}</div>`);
        continue;
      }

      // ── 아바타 (CSS class로 data URI 참조 — 중복 없음) ────────────
      const avCls = getAvCls(msg.username || '');
      const avatarHtml = imageMap[msg.username]
        ? `<div class="r20-avatar ${avCls}"></div>`
        : `<div class="r20-avatar"></div>`;

      // ── 행 배경색 ─────────────────────────────────────────────
      const customColor = userBubbleColors?.[msg.username] || null;
      const rowBg = customColor || (isMe ? '#dce8f5' : null);
      const rowStyle = rowBg ? ` style="background:${rowBg}"` : '';

      // ── 콘텐츠 ───────────────────────────────────────────────
      let content;
      if (msg.rawHtml) {
        content = msg.rawHtml;
      } else {
        content = escHtml(msg.chatMessage);
        content = content.replace(
          /(https?:\/\/[^\s<>"'ㄱ-ㆎ가-힣]+[^\s<>"'ㄱ-ㆎ가-힣.,;:!?()[\]{}])/g,
          url => `<a href="${url}" target="_blank" rel="noopener" class="r20-link">${url}</a>`
        );
        content = content.replace(/\n/g, '<br>');
      }
      if (msg.attachedImage) {
        content += `<div style="margin-top:6px"><img src="${escHtml(msg.attachedImage)}" style="max-width:240px;max-height:240px;border-radius:6px;display:block" alt=""></div>`;
      }

      const isRoll = msg.msgType === 'roll' || msg.msgType === 'roll-unknown' || msg.msgType === 'inline-roll';
      const nameBlock = isFirstInGroup
        ? `<div class="r20-name-inline">${escHtml(displayName)}</div>`
        : '';
      let bodyContent;
      if (isRoll) {
        // 주사위: 이름 위, 테이블 아래 (미리보기와 동일 구조)
        bodyContent = `${nameBlock}<div class="r20-roll-wrap" style="display:block;margin-top:2px">${content}</div>`;
      } else {
        // 일반: 이름: 내용 인라인
        const nameSpan = isFirstInGroup
          ? `<span class="r20-name-inline">${escHtml(displayName)}: </span>`
          : '';
        bodyContent = `<div class="r20-text">${nameSpan}${content}</div>`;
      }

      if (isFirstInGroup) {
        const rollCls = isRoll ? ' r20-roll-msg' : '';
        lines.push(`<div class="r20-msg r20-chat${rollCls}${isMe ? ' r20-mine' : ''}"${rowStyle}>
  ${avatarHtml}
  <div class="r20-body">${bodyContent}</div>
</div>`);
      } else {
        lines.push(`<div class="r20-msg r20-chat r20-cont${isMe ? ' r20-mine' : ''}"${rowStyle}>
  <div class="r20-avatar r20-avatar-spacer"></div>
  <div class="r20-body">${bodyContent}</div>
</div>`);
      }
    }

    const body = `<div class="r20-wrap">${lines.join('\n')}</div>`;

    if (forClipboard) return `<style>${css}</style>${body}`;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>롤20 채팅 백업</title>
<style>${css}</style>
</head>
<body>${body}</body>
</html>`;
  }

  _groupMessages(messages) {
    const groups = [];
    let currentGroup = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const key = `${msg.username}::${this._timeKey(msg.time)}`;

      if (!currentGroup || currentGroup.key !== key) {
        currentGroup = { key, messages: [] };
        groups.push(currentGroup);
      }
      currentGroup.messages.push({ index: i, message: msg });
    }
    return groups;
  }

  _timeKey(time) {
    // [2026. 1. 7. 오후 12:59] 형식은 이 정규식에 매칭되지 않습니다.
    const m = time.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+(오전|오후|AM|PM)\D+(\d{1,2}):(\d{2})/i);
    return m ? m.slice(1).join('-') : time;
  }

  // ── 공개 메서드 ──────────────────────────────────────────────

  async copyHtmlToClipboard() {
    try {
      this._showLoading('HTML 생성 중...');
      const html = await this._buildHtml(true);
      await navigator.clipboard.writeText(html);
      this.app.uiManager.showToast('클립보드에 복사됐어요');
    } catch (e) {
      console.error(e);
      alert('복사 실패: ' + e.message);
    } finally {
      this._hideLoading();
    }
  }

  async downloadHtmlFile() {
    try {
      this._showLoading('HTML 파일 생성 중...');
      const html = await this._buildHtml(false);
      this._download(html, this._buildFilename('html'), 'text/html');
      this.app.uiManager.showToast('HTML 저장됨');
    } catch (e) {
      alert('다운로드 실패: ' + e.message);
    } finally {
      this._hideLoading();
    }
  }

  async downloadTxtFile() {
    try {
      // HTML과 동일 내용을 .txt 확장자로 저장
      this._showLoading('파일 생성 중...');
      const html = await this._buildHtml(false);
      this._download(html, this._buildFilename('txt'), 'text/html');
      this.app.uiManager.showToast('TXT 저장됨');
    } catch (e) {
      alert('다운로드 실패: ' + e.message);
    } finally {
      this._hideLoading();
    }
  }

  _avatarChar(name) {
    if (!name) return '?';
    // 앞쪽 괄호 블록([사망], (KP) 등) 전부 제거 후 첫 의미있는 글자
    const stripped = name
      .replace(/^(\s*[\[\(【<「『《〈][^\]\)】>」』》〉]*[\]\)】>」』》〉]\s*)+/, '')
      .trim();
    return (stripped[0] || name[0] || '?').toUpperCase();
  }

  _download(content, filename, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  _dateStr() {
    return new Date().toISOString().slice(0, 10);
  }

  _extractDateFromMsg(timeStr) {
    if (!timeStr) return null;
    // 한국어: "2024년 1월 18일"
    let m = timeStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (m) return `${m[1]}${String(m[2]).padStart(2,'0')}${String(m[3]).padStart(2,'0')}`;
    // 영어: "February 28, 2026" / "May 09, 2026"
    const months = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
    m = timeStr.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
    if (m) {
      const mon = months[m[1].slice(0,3)];
      if (mon) return `${m[3]}${String(mon).padStart(2,'0')}${String(m[2]).padStart(2,'0')}`;
    }
    return null;
  }

  _buildFilename(ext) {
    const { messages, detectedPlatform, displayNames } = this.app.state;
    const platform = detectedPlatform || 'chat';
    const labels = { band:'밴드', kakao:'카카오톡', discord:'디스코드', roll20:'롤20' };
    const plat = labels[platform] || platform;

    // 참여자 수
    const users = new Set((messages||[]).map(m => m.username));
    const count = users.size;

    // 날짜 범위
    const dates = (messages||[]).map(m => this._extractDateFromMsg(m.time)).filter(Boolean).sort();
    const dateRange = dates.length
      ? (dates[0] === dates[dates.length-1] ? dates[0] : `${dates[0]}-${dates[dates.length-1]}`)
      : this._dateStr().replace(/-/g,'');

    return `${plat}(${count}명)_${dateRange}.${ext}`;
  }

  _contrastColor(hex) {
    const c = (hex || '').replace('#', '');
    if (c.length !== 6) return '#ffffff';
    const r = parseInt(c.substr(0,2),16), g = parseInt(c.substr(2,2),16), b = parseInt(c.substr(4,2),16);
    return (0.299*r + 0.587*g + 0.114*b)/255 > 0.5 ? '#1a1a1a' : '#ffffff';
  }

  _showLoading(msg) {
    if (this.app.uiManager) this.app.uiManager.toggleLoading(true, msg);
  }
  _hideLoading() {
    if (this.app.uiManager) this.app.uiManager.toggleLoading(false);
  }
}
