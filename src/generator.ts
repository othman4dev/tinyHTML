import { ASTNode, DoctypeNode, TagNode, TextNode } from './types';
import * as prettier from 'prettier';

export interface GeneratorOptions {
  indentSize?: number;
  indentType?: 'spaces' | 'tabs';
  preserveWhitespace?: boolean;
  minify?: boolean;
  usePrettier?: boolean;
  prettierOptions?: prettier.Options;
}

export class HTMLGenerator {
  private indentLevel: number = 0;
  private options: GeneratorOptions;
  private currentParentTag: string = '';
  private disposed: boolean = false;
  private outputBuffer: string[] = []; // Buffer for efficient string building

  constructor(options: GeneratorOptions = {}) {
    this.options = {
      indentSize: 2,
      indentType: 'spaces',
      preserveWhitespace: false,
      minify: false,
      usePrettier: true,
      prettierOptions: {
        parser: 'html',
        printWidth: 80,
        tabWidth: 2,
        useTabs: false,
        htmlWhitespaceSensitivity: 'css',
        bracketSameLine: false,
      },
      ...options
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    
    this.indentLevel = 0;
    this.currentParentTag = '';
    this.outputBuffer.length = 0;
    this.disposed = true;
  }

  private throwError(message: string): never {
    throw new Error(`HTML Generator Error: ${message}`);
  }

  private get indentString(): string {
    if (this.options.minify) return '';
    
    const size = this.options.indentSize || 2;
    return this.options.indentType === 'tabs' 
      ? '\t'.repeat(this.indentLevel)
      : ' '.repeat(this.indentLevel * size);
  }

  private get newLine(): string {
    return this.options.minify ? '' : '\n';
  }

  private indent(): string {
    return this.options.minify ? '' : this.indentString;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escapeAttributeValue(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private generateAttributes(attributes: Array<{ name: string; value: string | boolean }>, classes: string[], id?: string): string {
    const attrs: string[] = [];
    
    if (classes.length > 0) {
      attrs.push(`class="${classes.join(' ')}"`);
    }
    
    if (id) {
      attrs.push(`id="${id}"`);
    }
    
    for (const attr of attributes) {
      if (attr.value === true) {
        attrs.push(attr.name);
      } else {
        attrs.push(`${attr.name}="${this.escapeAttributeValue(attr.value.toString())}"`);
      }
    }
    
    return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  }

  private generateDoctype(node: DoctypeNode): void {
    this.outputBuffer.push(`<!DOCTYPE ${node.doctype}>`);
  }

  private generateTag(node: TagNode): void {
    const attrs = this.generateAttributes(node.attributes, node.classes, node.id);
    const tagName = node.name;
    
    if (node.selfClosing) {
      this.outputBuffer.push(this.indent(), '<', tagName, attrs, ' />');
      return;
    }
    
    if (node.children.length === 0) {
      this.outputBuffer.push(this.indent(), '<', tagName, attrs, '></', tagName, '>');
      return;
    }
    
    // Check for single text content (inline)
    if (node.children.length === 1 && node.children[0].type === 'text') {
      const textContent = (node.children[0] as TextNode).content;
      const shouldEscape = !['script', 'style'].includes(tagName.toLowerCase());
      const processedText = shouldEscape ? this.escapeHtml(textContent) : textContent.trim();
      
      if (processedText.length < 80 && !processedText.includes('\n')) {
        this.outputBuffer.push(this.indent(), '<', tagName, attrs, '>', processedText, '</', tagName, '>');
        return;
      }
    }
    
    // Multi-line tag with children
    this.outputBuffer.push(this.indent(), '<', tagName, attrs, '>');
    
    if (!this.options.minify) {
      this.outputBuffer.push(this.newLine);
      this.indentLevel++;
    }
    
    for (const child of node.children) {
      const previousParent = this.currentParentTag;
      this.currentParentTag = tagName;
      this.generateNode(child);
      this.currentParentTag = previousParent;
      
      if (!this.options.minify) {
        this.outputBuffer.push(this.newLine);
      }
    }
    
    if (!this.options.minify) {
      this.indentLevel--;
    }
    
    this.outputBuffer.push(this.indent(), '</', tagName, '>');
  }

  private generateText(node: TextNode): void {
    const lines = node.content.split('\n');
    const shouldEscape = !['script', 'style'].includes(this.currentParentTag.toLowerCase());
    
    if (this.options.minify) {
      const text = shouldEscape ? this.escapeHtml(node.content.trim()) : node.content.trim();
      this.outputBuffer.push(text);
      return;
    }
    
    if (lines.length === 1) {
      const text = shouldEscape ? this.escapeHtml(node.content.trim()) : node.content.trim();
      this.outputBuffer.push(this.indent(), text);
      return;
    }
    
    // Multi-line text
    for (let i = 0; i < lines.length; i++) {
      const trimmedLine = lines[i].trim();
      if (!trimmedLine) continue;
      
      const text = shouldEscape ? this.escapeHtml(trimmedLine) : trimmedLine;
      if (i === 0 && this.indentLevel === 0) {
        this.outputBuffer.push(text);
      } else {
        this.outputBuffer.push(this.indent(), text);
      }
      
      if (i < lines.length - 1) {
        this.outputBuffer.push(this.newLine);
      }
    }
  }

  public async generate(ast: ASTNode[], options?: Partial<GeneratorOptions>): Promise<string> {
    if (this.disposed) {
      this.throwError('Generator has been disposed');
    }
    
    if (options) {
      this.options = { ...this.options, ...options };
    }
    
    this.indentLevel = 0;
    this.outputBuffer.length = 0;
    
    // Build HTML using buffer
    for (const node of ast) {
      this.generateNode(node);
      if (!this.options.minify) {
        this.outputBuffer.push(this.newLine);
      }
    }
    
    let html = this.outputBuffer.join('');
    
    // Use prettier with timeout protection
    if (this.options.usePrettier && !this.options.minify) {
      try {
        const formattingPromise = prettier.format(html, {
          parser: 'html',
          printWidth: 100,
          tabWidth: 2,
          useTabs: false,
          htmlWhitespaceSensitivity: 'css',
          bracketSameLine: false,
          ...this.options.prettierOptions
        });
        
        html = await Promise.race([
          formattingPromise,
          new Promise<string>((_, reject) => 
            setTimeout(() => reject(new Error('Prettier timeout')), 5000)
          )
        ]);
      } catch (error) {
        // Fallback formatting without logging
        html = this.formatHTML(html);
      }
    } else if (!this.options.minify) {
      html = this.formatHTML(html);
    }
    
    // Clear buffer
    this.outputBuffer.length = 0;
    
    return html;
  }

  private formatHTML(html: string): string {
    return html
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .replace(/^\s*\n|\n\s*$/g, '')
      .split('\n')
      .map(line => line.trimRight())
      .join('\n');
  }

  private generateNode(node: ASTNode): void {
    switch (node.type) {
      case 'doctype':
        this.generateDoctype(node as DoctypeNode);
        break;
      case 'tag':
        this.generateTag(node as TagNode);
        break;
      case 'text':
        this.generateText(node as TextNode);
        break;
    }
  }
}
