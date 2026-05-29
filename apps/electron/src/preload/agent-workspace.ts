/**
 * Preload Agent 工作区管理、MCP 配置、Skills（AGENT_IPC_CHANNELS 第二部分）
 */

import { ipcRenderer } from 'electron'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type {
  AgentWorkspace,
  WorkspaceMcpConfig,
  SkillMeta,
  OtherWorkspaceSkillsGroup,
  WorkspaceCapabilities,
  SkillFileNode,
  SkillFileContent,
} from '@proma/shared'

const api: Record<string, unknown> = {
  // ===== 工作区管理 =====
  listAgentWorkspaces: () => ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_WORKSPACES),
  createAgentWorkspace: (name: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_WORKSPACE, name),
  updateAgentWorkspace: (id: string, updates: { name: string }) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_WORKSPACE, id, updates),
  deleteAgentWorkspace: (id: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_WORKSPACE, id),
  reorderAgentWorkspaces: (orderedIds: string[]) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.REORDER_WORKSPACES, orderedIds),

  // ===== MCP =====
  getWorkspaceCapabilities: (workspaceSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_CAPABILITIES, workspaceSlug),
  getWorkspaceMcpConfig: (workspaceSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_MCP_CONFIG, workspaceSlug),
  saveWorkspaceMcpConfig: (workspaceSlug: string, config: WorkspaceMcpConfig) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG, workspaceSlug, config),

  testMcpServer: (name: string, entry: import('@proma/shared').McpServerEntry) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.TEST_MCP_SERVER, name, entry) as Promise<{ success: boolean; message: string }>,

  // ===== Skills =====
  getWorkspaceSkills: (workspaceSlug: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS, workspaceSlug),
  getWorkspaceSkillsDir: (workspaceSlug: string) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS_DIR, workspaceSlug),

  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SKILL, workspaceSlug, skillSlug),

  toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_SKILL, workspaceSlug, skillSlug, enabled),

  getOtherWorkspaceSkills: (currentSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_OTHER_WORKSPACE_SKILLS, currentSlug),

  importSkillFromWorkspace: (targetSlug: string, sourceSlug: string, skillSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.IMPORT_SKILL_FROM_WORKSPACE, targetSlug, sourceSlug, skillSlug),

  updateSkillFromSource: (targetSlug: string, skillSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SKILL_FROM_SOURCE, targetSlug, skillSlug),

  readSkillContent: (workspaceSlug: string, skillSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.READ_SKILL_CONTENT, workspaceSlug, skillSlug),

  writeSkillContent: (workspaceSlug: string, skillSlug: string, content: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.WRITE_SKILL_CONTENT, workspaceSlug, skillSlug, content),

  listSkillFiles: (workspaceSlug: string, skillSlug: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SKILL_FILES, workspaceSlug, skillSlug),

  readSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.READ_SKILL_FILE, workspaceSlug, skillSlug, relativePath),

  writeSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string, content: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.WRITE_SKILL_FILE, workspaceSlug, skillSlug, relativePath, content),

  createSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string, type: 'file' | 'directory') =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_SKILL_ENTRY, workspaceSlug, skillSlug, relativePath, type),

  deleteSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SKILL_ENTRY, workspaceSlug, skillSlug, relativePath),

  renameSkillEntry: (workspaceSlug: string, skillSlug: string, fromRelative: string, toRelative: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_SKILL_ENTRY, workspaceSlug, skillSlug, fromRelative, toRelative),
}

export default api
