class DiscordParser {
  constructor() {
    this.name = 'discord';
    this.label = '디스코드';

    // [핵심 보완] 줄바꿈이나 공백에 구애받지 않고, 문장 안에서 [2026. 1. 7. 오후 1:05] agplus_ 형식을 정확히 찾아내는 전역 정규식
    this._regexTimestamp = /\[(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2})\]\s+([^\s\n]+)/;
  }

  canParse(text) {
    if (!text || typeof text !== 'string') return false;

    // 1. 헤더에 Guild: 또는 Channel: 이 포함되어 있는지 확인
    const hasDiscordHeader = text.includes('Guild:') || text.includes('Channel:');
    
    // 2. 본문에 디스코드 고유의 한국어 타임스탬프 형태가 하나라도 존재하는지 확인
    const hasDiscordTS = this._regexTimestamp.test(text);

    // 둘 중 하나만 만족해도 확실한 디스코드 파일로 판정
    return hasDiscordHeader || hasDiscordTS;
  }

  parse(chatData) {
    // 줄바꿈 기호 통일 후 줄 단위 분리
    const lines = chatData.replace(/\r\n/g, '\n').split('\n');
    
    const messages = [];
    let currentMessage = null;

    for (let rawLine of lines) {
      const line = rawLine.trim();

      // 헤더 구분선(===)이나 헤더 정보 줄은 그냥 스킵
      if (line.startsWith('===') || line.startsWith('Guild:') || line.startsWith('Channel:') || line.startsWith('After:') || line.startsWith('Before:')) {
        continue;
      }

      // 꼬리말 스킵
      if (line.startsWith('Exported ') && line.includes('message')) continue;

      // 타임스탬프 매칭 검사
      const tsMatch = line.match(this._regexTimestamp);
      
      if (tsMatch) {
        // 이전에 누적하던 메시지가 완성되었다면 저장
        if (currentMessage && currentMessage.chatMessage.trim()) {
          messages.push(currentMessage);
        }
        
        // 새 메시지 시작
        currentMessage = {
          time: tsMatch[1].trim(),     // "2026. 1. 7. 오후 1:05"
          username: tsMatch[2].trim(), // "agplus_"
          chatMessage: '',
        };
        continue;
      }

      // 첫 메시지가 발견되기 전의 공백이나 헤더 잔여물은 스킵
      if (!currentMessage) continue;

      // 무의미한 메타 데이터 라인 스킵
      if (
        line.startsWith('{Attachments}') ||
        line.startsWith('{Reactions}') ||
        line.startsWith('{Embed}') ||
        line.startsWith('{Stickers}')
      ) {
        continue;
      }

      // 본문 누적 (빈 줄이 오면 단락 구분을 위해 줄바꿈 추가)
      if (!line) {
        if (currentMessage.chatMessage && !currentMessage.chatMessage.endsWith('\n')) {
          currentMessage.chatMessage += '\n';
        }
        continue;
      }

      if (currentMessage.chatMessage) {
        if (currentMessage.chatMessage.endsWith('\n')) {
          currentMessage.chatMessage += line;
        } else {
          currentMessage.chatMessage += '\n' + line;
        }
      } else {
        currentMessage.chatMessage = line;
      }
    }

    // 마지막으로 남아있던 메시지 잔여분 추가
    if (currentMessage && currentMessage.chatMessage.trim()) {
      messages.push(currentMessage);
    }

    return messages;
  }
}
