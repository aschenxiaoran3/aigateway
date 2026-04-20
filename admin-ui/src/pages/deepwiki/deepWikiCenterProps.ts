export interface DeepWikiCenterProps {
  onOpenRuntimeTrace?: (traceId: string) => void;
  onOpenKnowledge?: () => void;
  onOpenDocBundle?: (bundleId: number) => void;
  /** 来自 /deepwiki/project/:id，锁定当前选中的 Deep Wiki 项目 */
  initialProjectId?: number;
}
