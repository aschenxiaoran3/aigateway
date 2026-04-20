import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

const DeepWikiProjectPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const target = projectId ? `/deepwiki?project=${encodeURIComponent(projectId)}` : '/deepwiki';
  return <Navigate to={target} replace />;
};

export default DeepWikiProjectPage;
