import fs from 'fs/promises';
import path from 'path';
import { ThoughtBranch } from '../types.js';

export interface PersistenceManager {
  saveState(): Promise<void>;
  loadState(): Promise<void>;
  enableAutoSave(interval: number): void;
}

export class ChoffPersistenceManager implements PersistenceManager {
  private branchManager: { 
    getAllBranches: () => ThoughtBranch[];
    reconstructBranch: (branch: ThoughtBranch) => void;
  };
  private storageDir: string;
  private autoSaveInterval?: NodeJS.Timeout;

  constructor(branchManager: any, storageDir: string) {
    this.branchManager = branchManager;
    this.storageDir = storageDir;
  }

  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.access(this.storageDir);
    } catch {
      await fs.mkdir(this.storageDir, { recursive: true });
    }
  }

  async saveState(): Promise<void> {
    await this.ensureStorageDir();
    const branches = this.branchManager.getAllBranches();
    
    // Save each branch to its own file
    for (const branch of branches) {
      const filePath = path.join(this.storageDir, `${branch.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(branch, null, 2), 'utf8');
    }

    // Create an index file
    const index = branches.map(b => ({
      id: b.id,
      state: b.state,
      priority: b.priority,
      thoughtCount: b.thoughts.length,
      lastUpdated: b.thoughts[b.thoughts.length - 1]?.timestamp || new Date()
    }));

    await fs.writeFile(
      path.join(this.storageDir, 'index.json'),
      JSON.stringify(index, null, 2),
      'utf8'
    );
  }

  async loadState(): Promise<void> {
    try {
      await this.ensureStorageDir();
      const files = await fs.readdir(this.storageDir);
      
      for (const file of files) {
        if (file.endsWith('.json') && file !== 'index.json') {
          const filePath = path.join(this.storageDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const branch = JSON.parse(content);
          
          // Convert ISO strings back to Date objects
          branch.thoughts.forEach((t: any) => {
            t.timestamp = new Date(t.timestamp);
          });
          
          this.branchManager.reconstructBranch(branch);
        }
      }
    } catch (error) {
      console.error('Error loading state:', error);
      throw new Error('Failed to load persisted state');
    }
  }

  enableAutoSave(interval: number): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    
    this.autoSaveInterval = setInterval(async () => {
      try {
        await this.saveState();
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, interval);
  }

  disableAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = undefined;
    }
  }
}