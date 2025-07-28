export interface ASTNode {
  type: 'doctype' | 'tag' | 'text';
}

export interface DoctypeNode extends ASTNode {
  type: 'doctype';
  doctype: string;
}

export interface TagNode extends ASTNode {
  type: 'tag';
  name: string;
  classes: string[];
  id?: string;
  attributes: Array<{ name: string; value: string | boolean }>;
  children: ASTNode[];
  selfClosing: boolean;
}

export interface TextNode extends ASTNode {
  type: 'text';
  content: string;
}
