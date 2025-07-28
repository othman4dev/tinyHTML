import { ASTNode, DoctypeNode, TagNode, TextNode } from './types';

interface Token {
  type: 'doctype' | 'tag' | 'text' | 'newline' | 'eof';
  value: string;
  indent: number;
  line: number;
  column: number;
}

export class TinyHTMLParser {
  private input: string;
  private position: number = 0;
  private line: number = 1;
  private column: number = 1;
  private indentStack: number[] = [0];
  private disposed: boolean = false;

  constructor(input: string) {
    // Input validation and security checks
    if (!input || typeof input !== 'string') {
      throw new Error('Invalid input: must be a non-empty string');
    }
    
    if (input.length > 10 * 1024 * 1024) { // 10MB limit
      throw new Error('Input too large: file size exceeds 10MB limit. Consider splitting into smaller files.');
    }
    
    // Check for potentially malicious patterns
    if (input.includes('\x00') || input.includes('\uFFFE') || input.includes('\uFFFF')) {
      throw new Error('Invalid input: contains null bytes or invalid Unicode characters');
    }
    
    this.input = input.trim();
  }

  public dispose(): void {
    if (this.disposed) return;
    
    this.input = '';
    this.position = 0;
    this.line = 1;
    this.column = 1;
    this.indentStack = [];
    this.disposed = true;
  }

  private throwError(message: string): never {
    throw new Error(`TinyHTML Parse Error at line ${this.line}, column ${this.column}: ${message}`);
  }

  private peek(offset: number = 0): string {
    if (this.disposed) {
      this.throwError('Parser has been disposed');
    }
    return this.input[this.position + offset] || '';
  }

  private advance(): string {
    if (this.disposed) {
      this.throwError('Parser has been disposed');
    }
    
    if (this.position >= this.input.length) {
      this.throwError('Unexpected end of input');
    }
    
    const char = this.input[this.position++];
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  private skipWhitespace(): void {
    if (this.disposed) {
      this.throwError('Parser has been disposed');
    }
    
    while (this.position < this.input.length && /[ \t]/.test(this.peek())) {
      this.advance();
    }
  }

  private readIdentifier(): string {
    if (this.disposed) {
      this.throwError('Parser has been disposed');
    }
    
    let result = '';
    const maxIdentifierLength = 100; // Prevent extremely long identifiers
    
    while (this.position < this.input.length && /[a-zA-Z0-9_-]/.test(this.peek())) {
      if (result.length >= maxIdentifierLength) {
        this.throwError(`Identifier too long: maximum ${maxIdentifierLength} characters allowed`);
      }
      result += this.advance();
    }
    
    if (result.length === 0) {
      this.throwError('Expected identifier but found none');
    }
    
    return result;
  }

  private readString(quote: string): string {
    if (this.disposed) {
      this.throwError('Parser has been disposed');
    }
    
    let result = '';
    const maxStringLength = 10000; // Prevent extremely long strings
    this.advance(); // Skip opening quote
    
    while (this.position < this.input.length && this.peek() !== quote) {
      if (result.length >= maxStringLength) {
        this.throwError(`String too long: maximum ${maxStringLength} characters allowed`);
      }
      
      if (this.peek() === '\\') {
        this.advance(); // Skip escape character
        if (this.position >= this.input.length) {
          this.throwError('Unexpected end of input in escaped string');
        }
        result += this.advance(); // Add escaped character
      } else {
        result += this.advance();
      }
    }
    
    if (this.peek() === quote) {
      this.advance(); // Skip closing quote
    } else {
      this.throwError(`Unterminated string: expected closing ${quote}`);
    }
    
    return result;
  }

  private getIndentLevel(pos: number = this.position): number {
    let level = 0;
    let i = pos;
    
    while (i < this.input.length && this.input[i] === ' ') {
      level++;
      i++;
    }
    
    return level;
  }

  private readLine(): string {
    let result = '';
    while (this.position < this.input.length && this.peek() !== '\n') {
      result += this.advance();
    }
    return result;
  }

  private parseTagLine(line: string): {
    name: string;
    classes: string[];
    id?: string;
    attributes: Array<{ name: string; value: string | boolean }>;
    content?: string;
  } {
    if (!line || line.trim().length === 0) {
      this.throwError('Empty tag line');
    }
    
    const maxAttributes = 50; // Prevent attribute flooding
    let pos = 0;
    
    const peek = (offset = 0) => line[pos + offset] || '';
    const advance = () => line[pos++];
    const skipWhitespace = () => {
      while (pos < line.length && /[ \t]/.test(peek())) {
        pos++;
      }
    };
    
    const readIdentifier = () => {
      let result = '';
      while (pos < line.length && /[a-zA-Z0-9_-]/.test(peek())) {
        result += advance();
      }
      return result;
    };

    // Parse tag name
    const name = readIdentifier();
    
    // Parse classes
    const classes: string[] = [];
    while (peek() === '.') {
      advance(); // Skip '.'
      classes.push(readIdentifier());
    }
    
    // Parse ID
    let id: string | undefined;
    if (peek() === '#') {
      advance(); // Skip '#'
      id = readIdentifier();
    }
    
    // Parse attributes (can have multiple [attr=value] blocks)
    const attributes: Array<{ name: string; value: string | boolean }> = [];
    while (peek() === '[') {
      advance(); // Skip '['
      
      while (pos < line.length && peek() !== ']') {
        skipWhitespace();
        
        const attrName = readIdentifier();
        if (!attrName) break;
        
        skipWhitespace();
        
        if (peek() === '=') {
          advance(); // Skip '='
          skipWhitespace();
          
          let value: string;
          if (peek() === '"' || peek() === "'") {
            const quote = advance();
            value = '';
            while (pos < line.length && peek() !== quote) {
              if (peek() === '\\') {
                advance(); // Skip escape
                if (pos < line.length) {
                  value += advance();
                }
              } else {
                value += advance();
              }
            }
            if (peek() === quote) advance(); // Skip closing quote
          } else {
            // Read unquoted value until space or ]
            value = '';
            while (pos < line.length && peek() !== ']' && peek() !== ' ' && peek() !== '\t') {
              value += advance();
            }
          }
          
          attributes.push({ name: attrName, value });
        } else {
          attributes.push({ name: attrName, value: true });
        }
        
        skipWhitespace();
      }
      
      if (peek() === ']') {
        advance(); // Skip ']'
      }
      
      skipWhitespace();
    }
    
    skipWhitespace();
    
    // Check for content
    let content: string | undefined;
    
    if (peek() === ':') {
      advance(); // Skip ':'
      skipWhitespace();
      
      if (pos < line.length) {
        if (peek() === '|') {
          // Multiline text indicator or inline text with |
          advance(); // Skip '|'
          skipWhitespace();
          if (pos < line.length) {
            // Inline text after | 
            content = line.substr(pos).trim();
            // Remove quotes if the entire content is quoted
            if ((content.startsWith('"') && content.endsWith('"')) ||
                (content.startsWith("'") && content.endsWith("'"))) {
              content = content.slice(1, -1);
            }
          } else {
            // Just | means multiline content follows
            content = '|';
          }
        } else if (peek() === '"') {
          const quote = advance();
          content = '';
          while (pos < line.length && peek() !== quote) {
            content += advance();
          }
          if (peek() === quote) advance();
        } else {
          content = line.substr(pos).trim();
        }
      }
    }
    
    return { name, classes, id, attributes, content };
  }

  private parseMultilineText(baseIndent: number): string {
    const lines: string[] = [];
    
    while (this.position < this.input.length) {
      if (this.peek() === '\n') {
        this.advance();
        continue;
      }
      
      const indent = this.getIndentLevel();
      
      if (indent <= baseIndent) {
        break; // End of multiline text block
      }
      
      // Skip the indentation
      while (this.position < this.input.length && this.peek() === ' ') {
        this.advance();
      }
      
      const line = this.readLine();
      if (line.trim()) {
        lines.push(line.trim());
      }
      
      if (this.peek() === '\n') {
        this.advance();
      }
    }
    
    return lines.join('\n');
  }

  private parseChildren(parentIndent: number): ASTNode[] {
    const children: ASTNode[] = [];
    
    while (this.position < this.input.length) {
      // Skip empty lines
      if (this.peek() === '\n') {
        this.advance();
        continue;
      }
      
      const currentIndent = this.getIndentLevel();
      
      // If we've dedented, we're done with this level
      if (currentIndent <= parentIndent) {
        break;
      }
      
      // Skip indentation
      while (this.position < this.input.length && this.peek() === ' ') {
        this.advance();
      }
      
      const line = this.readLine().trim();
      
      if (!line) {
        if (this.peek() === '\n') {
          this.advance();
        }
        continue;
      }
      
      // Parse DOCTYPE
      if (line.startsWith('!DOCTYPE ')) {
        const doctype = line.substring(9).trim();
        children.push({
          type: 'doctype',
          doctype
        } as DoctypeNode);
      }
      // Parse multiline text  
      else if (line.startsWith('|')) {
        let textContent = '';
        
        if (line.length > 1 && line[1] === ' ') {
          // Single line with | prefix
          textContent = line.substring(2).trim();
          // Remove quotes if the entire content is quoted
          if ((textContent.startsWith('"') && textContent.endsWith('"')) ||
              (textContent.startsWith("'") && textContent.endsWith("'"))) {
            textContent = textContent.slice(1, -1);
          }
        } else if (line.length === 1) {
          // Multi-line text block
          textContent = this.parseMultilineText(currentIndent);
        } else {
          // Handle | "quoted text" case
          textContent = line.substring(1).trim();
          // Remove quotes if the entire content is quoted
          if ((textContent.startsWith('"') && textContent.endsWith('"')) ||
              (textContent.startsWith("'") && textContent.endsWith("'"))) {
            textContent = textContent.slice(1, -1);
          }
        }
        
        children.push({
          type: 'text',
          content: textContent
        } as TextNode);
      }
      // Parse tag
      else if (/^[a-zA-Z]/.test(line)) {
        const parsed = this.parseTagLine(line);
        
        const tag: TagNode = {
          type: 'tag',
          name: parsed.name,
          classes: parsed.classes,
          id: parsed.id,
          attributes: parsed.attributes,
          children: [],
          selfClosing: ['br', 'hr', 'img', 'input', 'meta', 'link', 'source'].includes(parsed.name)
        };
        
        // Check for multiline content with |
        if (parsed.content === '|') {
          // This indicates multiline content follows
          if (this.peek() === '\n') {
            this.advance(); // Skip newline
          }
          
          const nextIndent = this.getIndentLevel();
          if (nextIndent > currentIndent) {
            const multilineContent = this.parseMultilineText(currentIndent);
            tag.children.push({
              type: 'text',
              content: multilineContent
            } as TextNode);
          }
        } else if (parsed.content) {
          // Regular inline content - remove quotes if entirely quoted
          let content = parsed.content;
          if ((content.startsWith('"') && content.endsWith('"')) ||
              (content.startsWith("'") && content.endsWith("'"))) {
            content = content.slice(1, -1);
          }
          tag.children.push({
            type: 'text',
            content: content
          } as TextNode);
        }
        
        // Skip newline
        if (this.peek() === '\n') {
          this.advance();
        }
        
        // Parse children if they exist
        if (this.position < this.input.length) {
          const nextIndent = this.getIndentLevel();
          if (nextIndent > currentIndent) {
            tag.children.push(...this.parseChildren(currentIndent));
          }
        }
        
        children.push(tag);
      }
      // Parse plain text
      else {
        children.push({
          type: 'text',
          content: line
        } as TextNode);
      }
      
      // Skip newline if present
      if (this.peek() === '\n') {
        this.advance();
      }
    }
    
    return children;
  }

  public parse(): ASTNode[] {
    return this.parseChildren(-1);
  }
}
