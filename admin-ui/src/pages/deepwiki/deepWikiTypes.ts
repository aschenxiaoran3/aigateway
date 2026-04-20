import type { DataNode } from 'antd/es/tree';
import type { DeepWikiPageRow } from '../../services/api';

export type WikiTreeNode = DataNode & {
  page?: DeepWikiPageRow;
  searchText?: string;
  children?: WikiTreeNode[];
};
