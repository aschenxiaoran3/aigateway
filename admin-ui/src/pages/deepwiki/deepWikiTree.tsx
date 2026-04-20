import React from 'react';
import { FileTextOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { Space } from 'antd';
import type { DeepWikiPageRow } from '../../services/api';
import { statusTag } from './deepWikiStatus';
import type { WikiTreeNode } from './deepWikiTypes';

const PROJECT_PAGE_ORDER = [
  '00-overview',
  '01-architecture-backbone',
  '03-product-architecture',
  '04-business-domain',
  '05-db-schema-and-data-model',
  '06-core-flows',
  '07-key-sequence-diagrams',
  '08-module-flow',
];

function compareTuple(left: Array<string | number>, right: Array<string | number>) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? '';
    const rightValue = right[index] ?? '';
    if (leftValue === rightValue) continue;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return leftValue - rightValue;
    }
    return String(leftValue).localeCompare(String(rightValue));
  }
  return 0;
}

function pageSortTuple(page: DeepWikiPageRow): Array<string | number> {
  const slug = String(page.page_slug || '').trim();
  const projectIndex = PROJECT_PAGE_ORDER.indexOf(slug);
  if (projectIndex >= 0) {
    return [0, projectIndex];
  }
  const parts = slug.split('/').filter(Boolean);
  const threadIndex = parts.indexOf('10-threads');
  if (threadIndex >= 0) {
    const domainKey = parts[1] || '';
    const threadKey = parts[threadIndex + 1] || '';
    const pageLeaf = parts[threadIndex + 2] || '';
    const threadBase = threadKey
      .replace(/-branch-\d+$/i, '')
      .replace(/-exception-\d+$/i, '');
    const threadRank = /-exception-\d+$/i.test(threadKey) ? 2 : /-branch-\d+$/i.test(threadKey) ? 1 : 0;
    const pageRank = /^00-/.test(pageLeaf) ? 0 : /^01-/.test(pageLeaf) ? 1 : 9;
    return [2, domainKey, threadBase, threadRank, threadKey, pageRank, slug];
  }
  if (slug.startsWith('10-domains/')) {
    const domainKey = parts[1] || '';
    const pageLeaf = parts[2] || '';
    const pageRank = /^00-/.test(pageLeaf) ? 0 : /^01-/.test(pageLeaf) ? 1 : 9;
    return [1, domainKey, pageRank, slug];
  }
  return [3, slug];
}

function comparePages(left: DeepWikiPageRow, right: DeepWikiPageRow) {
  return compareTuple(pageSortTuple(left), pageSortTuple(right));
}

export function buildWikiTreeData(pages: DeepWikiPageRow[]): WikiTreeNode[] {
  const roots: WikiTreeNode[] = [];
  const folderMap = new Map<string, WikiTreeNode>();

  const ensureFolder = (parts: string[]) => {
    let currentPath = '';
    let parentChildren = roots;

    parts.forEach((part) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let folder = folderMap.get(currentPath);
      if (!folder) {
        folder = {
          key: `folder:${currentPath}`,
          searchText: currentPath.toLowerCase(),
          title: (
            <Space size={6}>
              <FolderOpenOutlined />
              <span>{part}</span>
            </Space>
          ),
          children: [],
        };
        folderMap.set(currentPath, folder);
        parentChildren.push(folder);
      }
      parentChildren = folder.children as WikiTreeNode[];
    });

    return parentChildren;
  };

  [...pages]
    .sort(comparePages)
    .forEach((page) => {
      const parts = page.page_slug.split('/').filter(Boolean);
      const leafKey = `page:${page.id}`;
      const leafNode: WikiTreeNode = {
        key: leafKey,
        page,
        searchText: `${page.title} ${page.page_slug}`.toLowerCase(),
        title: (
          <Space size={6}>
            <FileTextOutlined />
            <span>{page.title}</span>
            {statusTag(page.ingest_status)}
          </Space>
        ),
        isLeaf: true,
      };
      if (parts.length <= 1) {
        roots.push(leafNode);
        return;
      }

      const parentChildren = ensureFolder(parts.slice(0, -1));
      parentChildren.push(leafNode);
    });

  return roots;
}

export function filterWikiTreeData(nodes: WikiTreeNode[], keyword: string): WikiTreeNode[] {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return nodes;
  return nodes
    .map((node) => {
      const children = filterWikiTreeData(node.children || [], normalized);
      const matched = String(node.searchText || '').includes(normalized);
      if (matched || children.length) {
        return {
          ...node,
          children,
        };
      }
      return null;
    })
    .filter(Boolean) as WikiTreeNode[];
}
