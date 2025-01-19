import chalk from 'chalk';
import { ThoughtBranch, ThoughtData, Insight, CrossReference, InsightType, CrossRefType, BranchingThoughtInput } from './types.js';
import { ChoffPersistenceManager, PersistenceManager } from './persistence/persistenceManager.js';

export class BranchManager {
  private branches: Map<string, ThoughtBranch> = new Map();
  private insightCounter = 0;
  private thoughtCounter = 0;
  private crossRefCounter = 0;
  private activeBranchId: string | null = null;
  private persistenceManager?: PersistenceManager;

  constructor(storageDir?: string) {
    if (storageDir) {
      this.persistenceManager = new ChoffPersistenceManager(this, storageDir);
      // Enable auto-save every 30 seconds
      this.persistenceManager.enableAutoSave(30000);
    }
  }

  async initialize(): Promise<void> {
    if (this.persistenceManager) {
      await this.persistenceManager.loadState();
    }
  }

  generateId(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `${prefix}-${timestamp}-${random}`;
  }

  createBranch(branchId: string, parentBranchId?: string): ThoughtBranch {
    const branch: ThoughtBranch = {
      id: branchId,
      parentBranchId,
      state: 'active',
      priority: 1.0,
      confidence: 1.0,
      thoughts: [],
      insights: [],
      crossRefs: []
    };
    this.branches.set(branchId, branch);
    // Set as active if it's the first branch
    if (!this.activeBranchId) {
      this.activeBranchId = branchId;
    }
    return branch;
  }

  private createInsight(
    type: InsightType,
    content: string,
    context: string[],
    parentInsights?: string[]
  ): Insight {
    return {
      id: `insight-${++this.insightCounter}`,
      type,
      content,
      context,
      parentInsights,
      applicabilityScore: 1.0,
      supportingEvidence: {}
    };
  }

  private createCrossReference(
    fromBranch: string,
    toBranch: string,
    type: CrossRefType,
    reason: string,
    strength: number
  ): CrossReference {
    return {
      id: `xref-${++this.crossRefCounter}`,
      fromBranch,
      toBranch,
      type,
      reason,
      strength,
      touchpoints: []
    };
  }

  addThought(input: BranchingThoughtInput): ThoughtData {
    // Use active branch if no branchId provided
    const branchId = input.branchId || this.activeBranchId || this.generateId('branch');
    let branch = this.branches.get(branchId);

    if (!branch) {
      branch = this.createBranch(branchId, input.parentBranchId);
    }

    const thought: ThoughtData = {
      id: `thought-${++this.thoughtCounter}`,
      content: input.content,
      branchId: branch.id,
      timestamp: new Date(),
      metadata: {
        type: input.type,
        confidence: input.confidence || 1.0,
        keyPoints: input.keyPoints || []
      }
    };

    branch.thoughts.push(thought);

    // Create insights if key points are provided
    if (input.keyPoints) {
      const insight = this.createInsight(
        'observation',
        `Identified key points: ${input.keyPoints.join(', ')}`,
        [input.type],
        input.relatedInsights
      );
      branch.insights.push(insight);
    }

    // Create cross references if specified
    if (input.crossRefs) {
      input.crossRefs.forEach(ref => {
        const crossRef = this.createCrossReference(
          branch!.id,
          ref.toBranch,
          ref.type,
          ref.reason,
          ref.strength
        );
        branch!.crossRefs.push(crossRef);
      });
    }

    this.updateBranchMetrics(branch);

    // Trigger persistence if enabled
    if (this.persistenceManager) {
      this.persistenceManager.saveState().catch(error => {
        console.error('Failed to persist state:', error);
      });
    }

    return thought;
  }

  reconstructBranch(branch: ThoughtBranch): void {
    // Update counters based on reconstructed branch
    branch.thoughts.forEach(t => {
      const thoughtNum = parseInt(t.id.split('-')[1]);
      this.thoughtCounter = Math.max(this.thoughtCounter, thoughtNum);
    });

    branch.insights.forEach(i => {
      const insightNum = parseInt(i.id.split('-')[1]);
      this.insightCounter = Math.max(this.insightCounter, insightNum);
    });

    branch.crossRefs.forEach(r => {
      const refNum = parseInt(r.id.split('-')[1]);
      this.crossRefCounter = Math.max(this.crossRefCounter, refNum);
    });

    // Store the reconstructed branch
    this.branches.set(branch.id, branch);

    // Set as active if it's the first branch
    if (!this.activeBranchId) {
      this.activeBranchId = branch.id;
    }
  }

  private updateBranchMetrics(branch: ThoughtBranch): void {
    const avgConfidence = branch.thoughts.reduce((sum, t) => sum + t.metadata.confidence, 0) / branch.thoughts.length;
    const insightScore = branch.insights.length * 0.1;
    const crossRefScore = branch.crossRefs.reduce((sum, ref) => sum + ref.strength, 0) * 0.1;

    branch.priority = avgConfidence + insightScore + crossRefScore;
    branch.confidence = avgConfidence;
  }

  getBranch(branchId: string): ThoughtBranch | undefined {
    return this.branches.get(branchId);
  }

  getAllBranches(): ThoughtBranch[] {
    return Array.from(this.branches.values());
  }

  getActiveBranch(): ThoughtBranch | undefined {
    return this.activeBranchId ? this.branches.get(this.activeBranchId) : undefined;
  }

  setActiveBranch(branchId: string): void {
    if (!this.branches.has(branchId)) {
      throw new Error(`Branch ${branchId} not found`);
    }
    this.activeBranchId = branchId;
  }

  getBranchHistory(branchId: string): string {
    const branch = this.branches.get(branchId);
    if (!branch) {
      throw new Error(`Branch ${branchId} not found`);
    }

    const header = chalk.blue(`History for branch: ${branchId} (${branch.state})`);
    const timeline = branch.thoughts.map((t, i) => {
      const timestamp = t.timestamp.toLocaleTimeString();
      const number = chalk.gray(`${i + 1}.`);
      const content = t.content;
      const type = chalk.yellow(`[${t.metadata.type}]`);
      const points = t.metadata.keyPoints.length > 0 
        ? chalk.green(`\n   Key Points: ${t.metadata.keyPoints.join(', ')}`)
        : '';
      return `${number} ${timestamp} ${type}\n   ${content}${points}`;
    }).join('\n\n');

    const insights = branch.insights.map(i =>
      chalk.yellow(`→ ${i.content}`)
    ).join('\n');

    return `
┌─────────────────────────────────────────────
│ ${header}
├─────────────────────────────────────────────
${timeline}
${insights ? `
├─────────────────────────────────────────────
│ Insights:
${insights}` : ''}
└─────────────────────────────────────────────`;
  }

  formatBranchStatus(branch: ThoughtBranch): string {
    const isActive = branch.id === this.activeBranchId;
    const header = `${chalk.blue('Branch:')} ${branch.id} (${branch.state})${isActive ? chalk.green(' [ACTIVE]') : ''}`;
    const stats = `Priority: ${branch.priority.toFixed(2)} | Confidence: ${branch.confidence.toFixed(2)}`;
    const thoughts = branch.thoughts.map(t => 
      `  ${chalk.green('•')} ${t.content} (${t.metadata.type})`
    ).join('\n');
    const insights = branch.insights.map(i =>
      `  ${chalk.yellow('→')} ${i.content}`
    ).join('\n');
    const crossRefs = branch.crossRefs.map(r =>
      `  ${chalk.magenta('↔')} ${r.toBranch}: ${r.reason} (${r.strength.toFixed(2)})`
    ).join('\n');

    return `
┌─────────────────────────────────────────────
│ ${header}
│ ${stats}
├─────────────────────────────────────────────
│ Thoughts:
${thoughts}
│ Insights:
${insights}
│ Cross References:
${crossRefs}
└─────────────────────────────────────────────`;
  }
}