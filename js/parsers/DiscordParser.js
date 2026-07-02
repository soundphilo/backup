// parsers/DiscordParser.js
// DiscordChatExporter TXT 형식 파서
//
// 헤더:
//   ============================================================
//   Guild: 서버명
//   Channel: 채널명
//   ============================================================
//
// 메시지:
//   [08-May-24 10:30 PM] 사용자명  또는  [2026. 1. 7. 오후 1:05] 사용자명
//   메시지 내용
//
// (pinned) 태그, Attachments, Reactions 등 포함 가능

class DiscordParser {
  constructor() {
    this.name = 'discord';
    this.label = '디스코드';

    // [수정] 한국어 날짜/시간 형식([2026. 1. 7. 오후 1:05]) 및 기존 영문 포맷을 모두 매칭하는 정규식
    // 자바스크립트 정규식 인덱스 기억 버그를 방지하기 위해 글로벌(g) 플래그를 사용하지 않습니다.
    this._regexTimestamp = /^\[(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2}|\d{2}-\w{3}-\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\]\s+(.+?)(?:\s+\(pinned\))?$/;

    // 헤더 구분선
    this._separator = /^={10,}$/;
  }

  canParse(text) {
    if (!text || typeof text !== 'string') return false;
    
    // [보안] 연속 호출 시 정규식 탐색 위치가 원치 않는 인덱스로 이동해 파싱에 실패하는 것을 방지
    this._regexTimestamp.lastIndex = 0;

    const lines = text.split('\n').slice(0, 30);

    // 구분선 + Guild/Channel 헤더 감지
    const hasSeparator = lines.some(l => this._separator.test(l.trim()));
    const hasGuild = lines.some(l => l.startsWith('Guild:') || l.startsWith('Channel:'));

    // 타임스탬프 형식 감지 (새로운 한국어 패턴인 연도 `[연도.` 형태도 포함하도록 패턴 업데이트)
    const tsPattern = /^\[(?:\d{2}-\w{3}-\d{2,4}\s+\d{1,2}:\d{2}|\d{4}\.\s*\d{1,2}\.)/;
    const hasTS = lines.some(l => tsPattern.test(l.trim()));

    return (hasSeparator && hasGuild) || hasTS;
  }

  parse(chatData) {
    // [보안] 파싱 직전 정규식 상태 초기화
    this._regexTimestamp.lastIndex = 0;

    const lines = chatData.split('\n');
    const messages = [];
    let currentMessage = null;
    let inHeader = true;
    let headerDone = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // 헤더 구간 처리 (첫 두 개의 구분선 사이)
      if (this._separator.test(line)) {
        headerDone++;
        if (headerDone >= 2) inHeader = false;
        continue;
      }
      if (inHeader) continue;

      // "Exported N message(s)" 꼬리말
      if (line.startsWith('Exported ') && line.includes('message')) continue;

      // 타임스탬프 라인 = 새 메시지 시작
      const tsMatch = line.match(this._regexTimestamp);
      if (tsMatch) {
        if (currentMessage) {
          currentMessage.chatMessage = currentMessage.chatMessage.trimEnd();
          messages.push(currentMessage);
        currentMessage = {
          time: tsMatch[1].trim(),
          username: tsMatch[2].trim(),
          chatMessage: '',
        };
        continue;
      }

      if (!currentMessage) continue;

      // 첨부파일/이모지 반응 등 메타 라인은 메시지에 포함시키되 빈 줄로 구분
      if (
        line.startsWith('{Attachments}') ||
        line.startsWith('{Reactions}') ||
        line.startsWith('{Embed}') ||
        line.startsWith('{Stickers}')
      ) {
        // 메타 정보는 스킵
        continue;
      }

      // 빈 줄: 메시지 사이 구분 (같은 화자의 연속 단락)
      if (!line) {
        if (currentMessage.chatMessage) currentMessage.chatMessage += '\n';
        continue;
      }

      // 메시지 본문 누적
      if (currentMessage.chatMessage) {
        currentMessage.chatMessage += '\n' + line;
      } else {
        currentMessage.chatMessage = line;
      }
    }

    if (currentMessage && currentMessage.chatMessage.trim()) {
      messages.push(currentMessage);
    }

    return messages;
  }
}
