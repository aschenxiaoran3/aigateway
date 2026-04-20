import React, { createContext, useContext, useMemo, useState } from 'react';

interface AppWorkspaceValue {
  projectCode?: string;
  setProjectCode: (value?: string) => void;
}

const AppWorkspaceContext = createContext<AppWorkspaceValue>({
  projectCode: undefined,
  setProjectCode: () => {},
});

export function AppWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [projectCode, setProjectCodeState] = useState<string>();

  const value = useMemo<AppWorkspaceValue>(
    () => ({
      projectCode,
      setProjectCode: (nextValue?: string) => {
        const normalized = String(nextValue || '').trim();
        setProjectCodeState(normalized || undefined);
      },
    }),
    [projectCode]
  );

  return <AppWorkspaceContext.Provider value={value}>{children}</AppWorkspaceContext.Provider>;
}

export function useAppWorkspace() {
  return useContext(AppWorkspaceContext);
}
