/**
 * Utilitário para parsing de arquivos CSV
 */

export interface ParsedContact {
  phone: string;
  name?: string;
}

const parseCSVLine = (line: string): ParsedContact | null => {
  if (!line || !line.trim()) {
    return null;
  }

  const parts = line
    .trim()
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1) {
    return {
      phone: parts[0],
    };
  }

  return {
    name: parts[0],
    phone: parts[1],
  };
};

/**
 * Detecta se a primeira linha é um cabeçalho
 */
const isHeaderLine = (line: string): boolean => {
  const lowerLine = line.toLowerCase();
  const headerKeywords = [
    'nome', 'name', 'telefone', 'phone', 'número', 'numero', 'celular',
    'whatsapp', 'contato', 'contact'
  ];
  return headerKeywords.some(keyword => lowerLine.includes(keyword));
};

export const parseCSVText = (csvText: string): ParsedContact[] => {
  if (!csvText || !csvText.trim()) {
    return [];
  }

  // Split por \r\n (Windows), \n (Unix/Linux), ou \r (Mac antigo/Excel)
  const lines = csvText.split(/\r\n|\r|\n/);
  console.log('🔍 Total de linhas no CSV:', lines.length);
  console.log('🔍 Primeiras 5 linhas:', lines.slice(0, 5));
  
  const contacts: ParsedContact[] = [];
  
  // Detectar se a primeira linha é um cabeçalho
  let startIndex = 0;
  if (lines.length > 0 && isHeaderLine(lines[0])) {
    console.log('📌 Primeira linha detectada como cabeçalho, pulando...');
    startIndex = 1; // Pular a primeira linha
  }
  
  for (let i = startIndex; i < lines.length; i++) {
    console.log(`📝 Processando linha ${i + 1}:`, lines[i]);
    const contact = parseCSVLine(lines[i]);
    console.log(`   → Resultado:`, contact);
    if (contact) {
      contacts.push(contact);
    }
  }

  console.log('✅ Total de contatos parseados:', contacts.length);
  return contacts;
};

export const parseCSVFile = async (fileBuffer: Buffer): Promise<ParsedContact[]> => {
  const csvText = fileBuffer.toString('utf-8');
  return parseCSVText(csvText);
};

export const parseInputText = (inputText: string): ParsedContact[] => {
  if (!inputText || !inputText.trim()) {
    return [];
  }

  // Split por \r\n (Windows), \n (Unix/Linux), ou \r (Mac antigo/Excel)
  const lines = inputText.split(/\r\n|\r|\n/);
  const contacts: ParsedContact[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes(';')) {
      const parts = trimmed.split(';').map((p) => p.trim());
      if (parts.length >= 2) {
        contacts.push({
          name: parts[0],
          phone: parts[1],
        });
      } else if (parts.length === 1) {
        contacts.push({
          phone: parts[0],
        });
      }
    } else {
      contacts.push({
        phone: trimmed,
      });
    }
  }

  return contacts;
};

