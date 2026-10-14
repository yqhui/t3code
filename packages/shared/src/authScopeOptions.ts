import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthDiagnosticsReadScope,
  AuthEnvironmentMaintainScope,
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  type AuthGrantScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthProvidersManageScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthSettingsWriteScope,
  AuthSourceControlWriteScope,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
} from "@t3tools/contracts";

export const AUTH_SCOPE_OPTIONS: ReadonlyArray<{
  readonly scope: AuthGrantScope;
  readonly title: string;
  readonly description: string;
}> = [
  {
    scope: AuthOrchestrationReadScope,
    title: "查看环境",
    description: "读取会话、状态、Checkpoint 和配置。",
  },
  {
    scope: AuthOrchestrationOperateScope,
    title: "操作任务",
    description: "启动、更新和停止任务。",
  },
  {
    scope: AuthSettingsWriteScope,
    title: "更改环境设置",
    description: "编辑环境偏好设置和快捷键绑定。",
  },
  {
    scope: AuthProvidersManageScope,
    title: "管理提供商",
    description: "配置、安装、登录和更新提供商及用量来源。",
  },
  {
    scope: AuthEnvironmentMaintainScope,
    title: "维护环境",
    description: "更新服务器并控制环境进程。",
  },
  {
    scope: AuthPreviewOperateScope,
    title: "控制预览",
    description: "打开浏览器预览并运行主机浏览器自动化。",
  },
  {
    scope: AuthDiagnosticsReadScope,
    title: "查看诊断和用量",
    description: "读取进程诊断、资源历史记录和总用量。",
  },
  {
    scope: AuthTerminalReadScope,
    title: "查看终端",
    description: "读取现有终端的输出和状态。",
  },
  {
    scope: AuthTerminalOperateScope,
    title: "使用终端",
    description: "创建终端并向正在运行的 Shell 发送输入。",
  },
  {
    scope: AuthSourceControlWriteScope,
    title: "更改源代码管理",
    description: "提交、推送、管理分支和仓库，以及更改拉取请求。",
  },
  {
    scope: AuthFilesystemReadScope,
    title: "读取文件",
    description: "浏览主机文件、搜索工作区并查看本地更改。",
  },
  {
    scope: AuthFilesystemWriteScope,
    title: "写入文件",
    description: "编辑工作区文件并将计划保存到磁盘。",
  },
  {
    scope: AuthAccessReadScope,
    title: "查看访问权限",
    description: "查看配对链接和已授权的客户端。",
  },
  {
    scope: AuthAccessWriteScope,
    title: "管理访问权限",
    description: "为其他客户端签发和撤销凭据。",
  },
  {
    scope: AuthRelayReadScope,
    title: "查看中继",
    description: "查看托管中继的连接状态。",
  },
  {
    scope: AuthRelayWriteScope,
    title: "管理中继",
    description: "更改托管隧道的连接状态。",
  },
];
