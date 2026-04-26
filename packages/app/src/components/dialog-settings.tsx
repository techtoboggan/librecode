import { Component } from "solid-js"
import { Dialog } from "@librecode/ui/dialog"
import { Tabs } from "@librecode/ui/tabs"
import { Icon } from "@librecode/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import {
  SettingsAgents,
  SettingsPlugins,
  SettingsSkills,
  SettingsTelemetry,
  SettingsTools,
} from "./settings-control-panel"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsMcpApps } from "./settings-mcp-apps"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"

export const DialogSettings: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <Dialog size="x-large" transition>
      <Tabs orientation="vertical" variant="settings" defaultValue="general" class="h-full settings-dialog">
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="mcp-apps">
                      <Icon name="dot-grid" />
                      MCP Apps
                    </Tabs.Trigger>
                  </div>
                </div>

                {/*
                  v0.9.74 — Agentic Control Panel section. Four tabs
                  (Agents, Skills, Plugins, Tools) backed by
                  /control-panel/* server endpoints. Skills tab
                  includes an "Import" affordance that pulls from a
                  curated catalog (Superpowers, Anthropic skills, …).
                  Read-only listings in this release; inline editing
                  lands later. The user described this section as a
                  "Windows-XP control panel" for librecode primitives.
                */}
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>Control Panel</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="agents">
                      <Icon name="speech-bubble" />
                      Agents
                    </Tabs.Trigger>
                    <Tabs.Trigger value="skills">
                      <Icon name="code-lines" />
                      Skills
                    </Tabs.Trigger>
                    <Tabs.Trigger value="plugins">
                      <Icon name="folder-add-left" />
                      Plugins
                    </Tabs.Trigger>
                    <Tabs.Trigger value="tools">
                      <Icon name="settings-gear" />
                      Tools
                    </Tabs.Trigger>
                    <Tabs.Trigger value="telemetry">
                      <Icon name="status-active" />
                      Telemetry
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        <Tabs.Content value="mcp-apps" class="no-scrollbar">
          <SettingsMcpApps />
        </Tabs.Content>
        <Tabs.Content value="agents" class="no-scrollbar">
          <SettingsAgents />
        </Tabs.Content>
        <Tabs.Content value="skills" class="no-scrollbar">
          <SettingsSkills />
        </Tabs.Content>
        <Tabs.Content value="plugins" class="no-scrollbar">
          <SettingsPlugins />
        </Tabs.Content>
        <Tabs.Content value="tools" class="no-scrollbar">
          <SettingsTools />
        </Tabs.Content>
        <Tabs.Content value="telemetry" class="no-scrollbar">
          <SettingsTelemetry />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
