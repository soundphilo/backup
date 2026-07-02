// parsers/KakaoParser.js
// 카카오톡 채팅 내보내기 파서
//
// PC 형식:
//   헤더: "카카오톡 대화\n저장한 사람 : ..." 또는 "----- 위 내용..."
//   메시지: 2024년 1월 15일 오전 10:30, 홍길동 : 메시지
//
// 모바일 형식:
//   헤더: "카카오톡 대화\n저장한 사람 : ..." 또는 "---------------"
//   날짜 구분선: "--------------- 2024년 1월 15일 월요일 ---------------"
//   메시지: [홍길동] [오전 10:30] 메시지
//
// 오픈채팅 모바일 형식:
//   날짜 구분선 동일
//   메시지: [홍길동] [오전 10:30] 메시지  (일반과 동일, 헤더/저장한 사람 없을 수 있음)

class KakaoParser {
  constructor() {
    this.name = 'kakao';
    this.label = '카카오톡';

    // PC: 2024년 1월 15일 오전 10:30, 홍길동 : 메시지
    this._regexPC = /^(\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:오전|오후)\s*\d{1,2}:\d{2}),\s*([^:]+?)\s*:\s*(.+)$/;

    // 모바일: [홍길동] [오전 10:30] 메시지
    this._regexMobile = /^\[(.+?)\]\s*\[(?:오전|오후)\s*\d{1,2}:\d{2}\]\s*(.+)$/;

    // 날짜 구분선 (모바일): "------- 2024년 1월 15일 화요일 -------"
    this._dateSeparator = /^-{3,}\s*(\d{4}년\s*\d{1,2}월\s*\d{1,2}일.+?)\s*-{3,}$/;

    this._currentDate = '';
  }

  canParse(text) {
    if (!text || typeof text !== 'string') return false;
    const lines = text.split('\n').slice(0, 50);

    // 헤더 감지
    const hasHeader = lines.some(l =>
      l.includes('카카오톡 대화') || l.includes('저장한 사람')
    );

    // PC 형식 감지
    const pcPattern = /\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:오전|오후)\s*\d{1,2}:\d{2},/;
    const hasPCFormat = lines.some(l => pcPattern.test(l));

    // 모바일 형식 감지 (일반/오픈채팅 공통)
    const mobilePattern = /^\[.+?\]\s*\[(?:오전|오후)\s*\d{1,2}:\d{2}\]/;
    const hasMobileFormat = lines.some(l => mobilePattern.test(l));

    return hasHeader || hasPCFormat || hasMobileFormat;
  }

  parse(chatData) {
    const lines = chatData.split('\n');
    const messages = [];
    let currentMessage = null;
    this._currentDate = '';

    // 형식 감지
    const isPC = lines.some(l =>
      /\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:오전|오후)\s*\d{1,2}:\d{2},/.test(l)
    );

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 날짜 구분선 (모바일/오픈채팅)
      const dateSepMatch = line.match(this._dateSeparator);
      if (dateSepMatch) {
        this._currentDate = dateSepMatch[1].trim();
        continue;
      }

      // 카카오 헤더/시스템 메시지 스킵
      if (this._isSystemLine(line)) {
        if (currentMessage) { messages.push(currentMessage); currentMessage = null; }
        continue;
      }

      if (isPC) {
        const pcMatch = line.match(this._regexPC);
        if (pcMatch) {
          if (currentMessage) messages.push(currentMessage);
          currentMessage = {
            time: pcMatch[1].trim(),
            username: pcMatch[2].trim(),
            chatMessage: this._normalizeMedia(pcMatch[3].trim()),
          };
          continue;
        }
      } else {
        // 모바일 / 오픈채팅
        const mobileMatch = line.match(this._regexMobile);
        if (mobileMatch) {
          if (currentMessage) messages.push(currentMessage);

          // 시간 추출 — [오전 10:30] 태그에서 직접 꺼냄
          // match /g 는 배열 반환, 인덱스 0 = 첫 번째 매치(이름 뒤 시간)
          const timeMatches = line.match(/\[(?:오전|오후)\s*\d{1,2}:\d{2}\]/g);
          const timeTag = timeMatches ? timeMatches[0] : null;
          const timeStr = timeTag
            ? `${this._currentDate} ${timeTag.replace(/[\[\]]/g, '').trim()}`
            : this._currentDate;

          currentMessage = {
            time: timeStr,
            username: mobileMatch[1].trim(),
            chatMessage: this._normalizeMedia(mobileMatch[2].trim()),
          };
          continue;
        }
      }

      // 연속 줄 (이전 메시지의 다음 줄)
      if (currentMessage) {
        currentMessage.chatMessage += '\n' + line;
      }
    }

    if (currentMessage) messages.push(currentMessage);
    return messages;
  }

  // ── 시스템 라인 판별 ─────────────────────────────────────────

  _isSystemLine(line) {
    return (
      line.startsWith('카카오톡 대화') ||
      line.startsWith('저장한 사람') ||
      line.match(/^-{5,}$/) ||
      line.startsWith('대화상대') ||
      line.includes('님이 나갔습니다') ||
      line.includes('님이 들어왔습니다') ||
      line.includes('채팅방을 나갔습니다') ||
      line.includes('초대하였습니다') ||
      line.includes('채팅방 관리자') ||
      // 오픈채팅 시스템 메시지
      line.includes('오픈채팅방을 개설했습니다') ||
      line.includes('채팅방 이름이 변경되었습니다') ||
      line.includes('으로 변경했습니다')
    );
  }

  // ── 미디어 메시지 정규화 ─────────────────────────────────────

  _normalizeMedia(msg) {
    // PC 형식에서도, 모바일 형식에서도 적용
    if (msg === '사진') return '[사진]';
    if (msg === '동영상') return '[동영상]';
    if (msg === '이모티콘') return '[이모티콘]';
    if (msg === '음성메시지') return '[음성메시지]';
    if (msg === '라이브톡') return '[라이브톡]';
    if (msg.startsWith('파일:')) return `[파일] ${msg.slice(3).trim()}`;
    // 삭제된 메시지: "삭제된 메시지입니다" 또는 유사 표현
    if (msg.includes('삭제된 메시지')) return '[삭제된 메시지]';
    // 오픈채팅 닉네임 변경 안내 (메시지 내용에 포함되는 경우)
    return msg;
  }
}