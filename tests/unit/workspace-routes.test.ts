import { describe, expect, it } from 'vitest';

import {
  isFirmWorkspacePath,
  shouldClearClientWorkspaceForPath,
} from '../../client/src/lib/workspaceRoutes';

describe('workspace route helpers', () => {
  it('treats firm routes as portfolio-wide workspaces', () => {
    expect(isFirmWorkspacePath('/firm/clients')).toBe(true);
    expect(isFirmWorkspacePath('/firm/clients/client-123')).toBe(true);
    expect(isFirmWorkspacePath('/firm/command-center?tab=vat')).toBe(true);
    expect(isFirmWorkspacePath('/firm/')).toBe(true);
  });

  it('does not treat client accounting routes as firm workspaces', () => {
    expect(isFirmWorkspacePath('/dashboard')).toBe(false);
    expect(isFirmWorkspacePath('/invoices')).toBe(false);
    expect(isFirmWorkspacePath('/vat-filing')).toBe(false);
    expect(isFirmWorkspacePath('/corporate-tax')).toBe(false);
  });

  it('clears client-book context before rendering firm-wide pages', () => {
    expect(shouldClearClientWorkspaceForPath('/firm/clients')).toBe(true);
    expect(shouldClearClientWorkspaceForPath('/firm/value-ops')).toBe(true);
    expect(shouldClearClientWorkspaceForPath('/reports')).toBe(false);
  });
});
