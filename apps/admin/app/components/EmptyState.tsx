export function EmptyState() {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">+</span>
      <h2>No prospects yet</h2>
      <p>Run a local Phase 4 fixture to create the first qualification case.</p>
      <code>pnpm.cmd prospect:qualify --fixture roofing-good</code>
    </div>
  );
}
