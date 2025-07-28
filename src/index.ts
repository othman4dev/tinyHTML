import * as fs from 'fs';
import * as path from 'path';
import { TinyHTMLParser } from './parser';
import { HTMLGenerator } from './generator';
import { LRUCache } from './cache';
import { logger, Logger, createLogger, LogLevel } from './logger';

// Performance metrics
interface CompilerMetrics {
  compilations: number;
  cacheHits: number;
  cacheMisses: number;
  totalTime: number;
  averageTime: number;
  memoryUsage: number;
}

// Object pool for parser instances
class ParserPool {
  private available: TinyHTMLParser[] = [];
  private readonly maxSize: number = 10;

  acquire(input: string): TinyHTMLParser {
    let parser = this.available.pop();
    if (!parser) {
      parser = new TinyHTMLParser(input);
    } else {
      // Reset parser for new input
      parser = new TinyHTMLParser(input);
    }
    return parser;
  }

  release(parser: TinyHTMLParser): void {
    if (this.available.length < this.maxSize) {
      parser.dispose();
      // Don't actually reuse parser instances due to input dependency
      // This is a simplified pool that just limits instances
    } else {
      parser.dispose();
    }
  }

  dispose(): void {
    for (const parser of this.available) {
      parser.dispose();
    }
    this.available = [];
  }
}

export class TinyHTMLCompiler {
  private generator: HTMLGenerator;
  private compilationCache: LRUCache<string, { html: string; mtime: number }>;
  private disposed: boolean = false;
  private parserPool: ParserPool;
  private maxConcurrentOperations: number = 50; // Throttle concurrent operations
  private activeOperations: number = 0;
  private logger: Logger;
  private metrics: CompilerMetrics;

  constructor(options: { logLevel?: LogLevel; logger?: Logger } = {}) {
    this.generator = new HTMLGenerator();
    this.compilationCache = new LRUCache<string, { html: string; mtime: number }>(100, 5 * 60 * 1000); // 100 entries, 5min TTL
    this.parserPool = new ParserPool();
    this.logger = options.logger || createLogger(options.logLevel || 'warn');
    this.metrics = {
      compilations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalTime: 0,
      averageTime: 0,
      memoryUsage: 0
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    
    this.generator.dispose();
    this.compilationCache.clear();
    this.parserPool.dispose();
    this.disposed = true;
  }

  private throwError(message: string): never {
    throw new Error(`TinyHTML Compiler Error: ${message}`);
  }

  private async waitForSlot(): Promise<void> {
    while (this.activeOperations >= this.maxConcurrentOperations) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.activeOperations++;
  }

  private releaseSlot(): void {
    this.activeOperations--;
  }

  public async compile(input: string): Promise<string> {
    if (this.disposed) {
      this.throwError('Compiler has been disposed');
    }

    const startTime = Date.now();
    await this.waitForSlot();
    
    try {
      const parser = this.parserPool.acquire(input);
      const ast = parser.parse();
      const html = await this.generator.generate(ast);
      
      this.parserPool.release(parser);
      
      // Update metrics
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, false);
      
      this.logger.debug('Compilation completed', { 
        duration, 
        inputLength: input.length, 
        outputLength: html.length 
      });
      
      return html;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Compilation failed', { error: errorMessage, inputLength: input.length });
      throw new Error(`TinyHTML compilation failed: ${errorMessage}`);
    } finally {
      this.releaseSlot();
    }
  }

  private updateMetrics(duration: number, cacheHit: boolean): void {
    this.metrics.compilations++;
    this.metrics.totalTime += duration;
    this.metrics.averageTime = this.metrics.totalTime / this.metrics.compilations;
    this.metrics.memoryUsage = process.memoryUsage().heapUsed;
    
    if (cacheHit) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }
  }

  public async compileFile(inputPath: string, outputPath?: string): Promise<void> {
    if (this.disposed) {
      this.throwError('Compiler has been disposed');
    }
    
    const startTime = Date.now();
    
    try {
      // Validate input path
      if (!inputPath || typeof inputPath !== 'string') {
        this.throwError('Invalid input path');
      }
      
      const resolvedInputPath = path.resolve(inputPath);
      
      // Check if file exists and get stats
      const stats = await fs.promises.stat(resolvedInputPath);
      if (!stats.isFile()) {
        this.throwError(`Input path is not a file: ${resolvedInputPath}`);
      }
      
      // Check file size
      if (stats.size > 50 * 1024 * 1024) { // 50MB limit
        this.throwError(`File too large: ${resolvedInputPath} exceeds 50MB`);
      }
      
      // Check cache
      const cacheKey = resolvedInputPath;
      const cached = this.compilationCache.get(cacheKey);
      if (cached && cached.mtime >= stats.mtimeMs) {
        const output = outputPath || inputPath.replace(/\.tml$/, '.html');
        await fs.promises.writeFile(output, cached.html, 'utf-8');
        
        const duration = Date.now() - startTime;
        this.updateMetrics(duration, true);
        this.logger.debug('Used cached compilation', { path: resolvedInputPath, duration });
        return;
      }
      
      // Read file asynchronously
      const input = await fs.promises.readFile(resolvedInputPath, 'utf-8');
      const html = await this.compile(input);
      
      // Cache the result
      this.compilationCache.set(cacheKey, {
        html,
        mtime: stats.mtimeMs
      }, stats.mtimeMs);
      
      const output = outputPath || inputPath.replace(/\.tml$/, '.html');
      
      // Ensure output directory exists
      const outputDir = path.dirname(output);
      await fs.promises.mkdir(outputDir, { recursive: true });
      
      // Write file asynchronously
      await fs.promises.writeFile(output, html, 'utf-8');
      
      const duration = Date.now() - startTime;
      this.logger.info('File compiled successfully', { 
        input: resolvedInputPath, 
        output, 
        duration,
        size: html.length 
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('File compilation failed', { path: inputPath, error: errorMessage });
      throw new Error(`File compilation failed for ${inputPath}: ${errorMessage}`);
    }
  }

  public async compileDirectory(dirPath: string, outputDir?: string, options: { recursive?: boolean; parallel?: boolean } = {}): Promise<void> {
    if (this.disposed) {
      this.throwError('Compiler has been disposed');
    }
    
    try {
      const resolvedDirPath = path.resolve(dirPath);
      const stats = await fs.promises.stat(resolvedDirPath);
      
      if (!stats.isDirectory()) {
        this.throwError(`Path is not a directory: ${resolvedDirPath}`);
      }
      
      const files = await fs.promises.readdir(resolvedDirPath);
      const compilationTasks: Promise<void>[] = [];
      
      for (const file of files) {
        const fullPath = path.join(resolvedDirPath, file);
        const stat = await fs.promises.stat(fullPath);
        
        if (stat.isDirectory() && options.recursive) {
          const subOutputDir = outputDir ? path.join(outputDir, file) : undefined;
          if (subOutputDir) {
            await fs.promises.mkdir(subOutputDir, { recursive: true });
          }
          
          // Recursively compile subdirectory
          const task = this.compileDirectory(fullPath, subOutputDir, options);
          
          if (options.parallel !== false) {
            compilationTasks.push(task);
          } else {
            await task;
          }
          
        } else if (stat.isFile() && file.endsWith('.tml')) {
          const outputPath = outputDir 
            ? path.join(outputDir, file.replace(/\.tml$/, '.html'))
            : fullPath.replace(/\.tml$/, '.html');
            
          // Ensure output directory exists
          if (outputDir) {
            await fs.promises.mkdir(outputDir, { recursive: true });
          }
          
          const task = this.compileFile(fullPath, outputPath).then(() => {
            console.log(`✅ Compiled: ${path.relative(process.cwd(), fullPath)} → ${path.relative(process.cwd(), outputPath)}`);
          });
          
          if (options.parallel !== false) {
            compilationTasks.push(task);
          } else {
            await task;
          }
        }
      }
      
      // Wait for all parallel tasks to complete
      if (compilationTasks.length > 0) {
        await Promise.all(compilationTasks);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Directory compilation failed for ${dirPath}: ${errorMessage}`);
    }
  }

  public async compileProject(projectRoot: string = '.'): Promise<void> {
    if (this.disposed) {
      this.throwError('Compiler has been disposed');
    }
    
    try {
      const resolvedRoot = path.resolve(projectRoot);
      const tmlDir = path.join(resolvedRoot, 'tinyhtml-views');
      const viewsDir = path.join(resolvedRoot, 'views');
      
      // Validate project structure
      try {
        const tmlStats = await fs.promises.stat(tmlDir);
        if (!tmlStats.isDirectory()) {
          this.throwError(`TinyHTML views directory is not a directory: ${tmlDir}`);
        }
      } catch (error) {
        this.throwError(`TinyHTML views directory not found: ${tmlDir}. Run 'tinyhtml init' to create project structure.`);
      }
      
      console.log(`🚀 Compiling TinyHTML project...`);
      console.log(`📁 Source: ${path.relative(process.cwd(), tmlDir)}`);
      console.log(`📁 Output: ${path.relative(process.cwd(), viewsDir)}`);
      console.log();
      
      const startTime = Date.now();
      
      // Enable parallel compilation for better performance
      await this.compileDirectory(tmlDir, viewsDir, { 
        recursive: true, 
        parallel: true 
      });
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      console.log();
      console.log(`✅ Project compilation complete! (${duration}s)`);
      console.log(`📊 Cache hits: ${this.compilationCache.getStats().size} files cached`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Project compilation failed: ${errorMessage}`);
    }
  }

  public clearCache(): void {
    this.compilationCache.clear();
    this.logger.info('Compilation cache cleared');
  }

  public getCacheStats(): { size: number; memoryUsage: string } {
    const stats = this.compilationCache.getStats();
    return {
      size: stats.size,
      memoryUsage: stats.memoryUsage
    };
  }

  public getMetrics(): CompilerMetrics & { cacheStats: ReturnType<LRUCache<string, any>['getStats']> } {
    return {
      ...this.metrics,
      cacheStats: this.compilationCache.getStats()
    };
  }

  // Cleanup expired cache entries
  public cleanupCache(): number {
    const cleaned = this.compilationCache.cleanup();
    if (cleaned > 0) {
      this.logger.debug('Cache cleanup completed', { entriesRemoved: cleaned });
    }
    return cleaned;
  }
}

// Export main API
export { TinyHTMLParser } from './parser';
export { HTMLGenerator } from './generator';
export * from './types';
