class DiscordParser {
  constructor() {
    this.name = 'discord';
    this.label = '디스코드';

    // [보완] 앞에 어떤 공백이나 줄바꿈(\s*)이 있더라도 타임스탬프와 사용자명을 완벽히 추출하는 정규식
    this._regexTimestamp = /\[(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2})\]\s+(.+?)(?:\s+\(pinned\))?$/;
    
    // 헤더 구분선
    this._separator = /^={5,}$/;
  }

  canParse(text) {
    if (!text || typeof text !== 'string') return false;
    
    // 줄바꿈 기호 통일 후 상위 100줄 검사
    const cleanedText = text.replace(/\r\n/g, '\n');
    const lines = cleanedText.split('\n').slice(0, 100);

    const hasSeparator = lines.some(l => this._separator.test(l.trim()));
    const hasGuild = lines.some(l => {
      const trimmed = l.trim();
      return trimmed.startsWith('Guild:') || trimmed.startsWith('Channel:');
    });

    // 제공해주신 한국어 타임스탬프 양식이 한 줄이라도 존재하는지 검사
    const hasTS = lines.some(l => this._regexTimestamp.test(l.trim()));

    return (hasSeparator && hasGuild) || hasTS;
  }

  parse(chatData) {
    // 1. 모든 줄바꿈을 \n으로 통일하고, 연속된 공백이나 무의미한 \r 노이즈 제거
    const lines = chatData.replace(/\r\n/g, '\n').split('\n');
    
    const messages = [];
    let currentMessage = null;
    let inHeader = true;
    let headerDone = 0;

    for (let rawLine of lines) {
      const line = rawLine.trim();

      // 헤더 구간 처리 (두 번째 구분선을 만날 때까지 헤더로 취급)
      if (this._separator.test(line)) {
        headerDone++;
        if (headerDone >= 2) inHeader = false;
        continue;
      }
      if (inHeader) continue;

      // 꼬리말 스킵
      if (line.startsWith('Exported ') && line.includes('message')) continue;

      // [핵심 보완] 줄의 앞뒤 공백을 정리한 뒤 타임스탬프 정규식 매칭
      const tsMatch = line.match(this._regexTimestamp);
      
      if (tsMatch) {
        // 이전까지 누적하던 메시지가 있다면 결과 배열에 푸시
        if (currentMessage) {
          messages.push(currentMessage);
        }
        // 새 메시지 객체 생성
        currentMessage = {
          time: tsMatch[1].trim(),
          username: tsMatch[2].trim(),
          chatMessage: '',
        };
        continue;
      }

      // 첫 메시지가 시작되기 전의 빈 줄이나 헤더 잔여물은 스킵
      if (!currentMessage) continue;

      // 메타 정보 라인 스킵
      if (
        line.startsWith('{Attachments}') ||
        line.startsWith('{Reactions}') ||
        line.startsWith('{Embed}') ||
        line.startsWith('{Stickers}')
      ) {
        continue;
      }

      // 빈 줄 처리 (제공해주신 본문 사이의 공백 엔터 유지)
      if (!line) {
        if (currentMessage.chatMessage) currentMessage.chatMessage += '\n';
        continue;
      }

      // 대화 본문 내용 누적
      if (currentMessage.chatMessage) {
        // 이미 줄바꿈이 끝에 들어가 있다면 그냥 이어붙이고, 아니면 엔터 추가
        if (currentMessage.chatMessage.endsWith('\n')) {
          currentMessage.chatMessage += line;
        } else {
          currentMessage.chatMessage += '\n' + line;
        }
      } else {
        currentMessage.chatMessage = line;
      }
    }

    // 루프가 끝난 후 마지막 남아있는 메시지 처리
    if (currentMessage && currentMessage.chatMessage.trim()) {
      messages.push(currentMessage);
    }

    return messages;
  }
}
