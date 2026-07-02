class DiscordParser {
  constructor() {
    this.name = 'discord';
    this.label = '디스코드';

    // [최종 보완] 시작/끝 기호(^, $)를 완전히 제거하여 줄바꿈이나 미세 공백 노이즈가 끼어도
    // 오직 날짜 형식과 그 뒤의 유저네임(공백 전까지)만 정확히 가로채는 정규식
    this._regexTimestamp = /\[(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2})\]\s+([^\s\n\r]+)/;
  }

  canParse(text) {
    console.log("웹 앱으로 들어온 원본 텍스트 앞부분:\n", text.slice(0, 300));
    console.log("헤더 매칭 결과:", text.includes('Guild:'), text.includes('Channel:'));
    console.log("정규식 검사 결과 (하나라도 나와야 함):", this._regexTimestamp.test(text));
    if (!text || typeof text !== 'string') return false;

    // 1. 본문에 디스코드 고유의 한국어 타임스탬프 형태가 하나라도 존재하는지 확인
    const hasDiscordTS = this._regexTimestamp.test(text);
    
    // 2. 헤더 키워드가 포함되어 있는지 확인 (BOM 노이즈 방어를 위해 includes로 유연하게 체크)
    const hasDiscordHeader = text.includes('Guild:') || text.includes('Channel:');

    // 둘 중 하나라도 발견되면 디스코드 파일로 강제 인정
    return hasDiscordTS || hasDiscordHeader;
  }

  parse(chatData) {
    // 모든 종류의 줄바꿈 기호를 \n으로 일괄 통일 후 줄 단위 분할
    const lines = chatData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    
    const messages = [];
    let currentMessage = null;

    for (let rawLine of lines) {
      const line = rawLine.trim();

      // 무의미한 헤더 선 및 정보 스킵
      if (!line || line.startsWith('===') || line.startsWith('Guild:') || line.startsWith('Channel:') || line.startsWith('After:') || line.startsWith('Before:')) {
        continue;
      }

      // 디스코드 내보내기 꼬리말 스킵
      if (line.startsWith('Exported ') && line.includes('message')) continue;

      // 타임스탬프 라인 검사
      const tsMatch = line.match(this._regexTimestamp);
      
      if (tsMatch) {
        // 이전에 파싱 중이던 메시지가 완성된 상태라면 저장소에 저장
        if (currentMessage && currentMessage.chatMessage.trim()) {
          messages.push(currentMessage);
        }
        
        // 새로운 메시지 객체 시작
        currentMessage = {
          time: tsMatch[1].trim(),     // "2026. 1. 7. 오후 1:05"
          username: tsMatch[2].trim(), // "agplus_"
          chatMessage: '',
        };
        continue;
      }

      // 첫 번째 타임스탬프가 발견되기 전의 최상단 텍스트 노이즈들은 무시
      if (!currentMessage) continue;

      // 디스코드 고유 메타 태그 라인 무시
      if (
        line.startsWith('{Attachments}') ||
        line.startsWith('{Reactions}') ||
        line.startsWith('{Embed}') ||
        line.startsWith('{Stickers}')
      ) {
        continue;
      }

      // 대화 본문 내용 누적 (여러 줄 메시지 및 줄바꿈 공백 유지)
      if (currentMessage.chatMessage) {
        currentMessage.chatMessage += '\n' + line;
      } else {
        currentMessage.chatMessage = line;
      }
    }

    // 파일이 끝난 후 제일 마지막에 남아있던 메시지 잔여분 최종 저장
    if (currentMessage && currentMessage.chatMessage.trim()) {
      messages.push(currentMessage);
    }

    return messages;
  }
}
