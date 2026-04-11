import { Show, type Component } from "solid-js"
import { Button } from "@librecode/ui/button"
import { DockTray } from "@librecode/ui/dock-surface"
import { Icon } from "@librecode/ui/icon"
import { ProviderIcon } from "@librecode/ui/provider-icon"
import { TooltipKeybind } from "@librecode/ui/tooltip"
import { Select } from "@librecode/ui/select"
import { useDialog } from "@librecode/ui/context/dialog"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { DialogSelectModelUnpaid } from "@/components/dialog-select-model-unpaid"
import { useLocal } from "@/context/local"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"

interface PromptToolbarProps {
  mode: "normal" | "shell"
  control: () => Record<string, string | number>
  shell: () => Record<string, string | number>
  agentNames: () => string[]
  variants: () => string[]
  accepting: () => boolean
  acceptLabel: () => string
  providersConnected: () => number
  onToggleAccept: () => void
}

export const PromptToolbar: Component<PromptToolbarProps> = (props) => {
  const local = useLocal()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()

  return (
    <Show when={props.mode === "normal" || props.mode === "shell"}>
      <DockTray attach="top">
        <div class="px-1.75 pt-5.5 pb-2 flex items-center gap-2 min-w-0">
          <div class="flex items-center gap-1.5 min-w-0 flex-1 relative">
            <div
              class="h-7 flex items-center gap-1.5 max-w-[160px] min-w-0 absolute inset-y-0 left-0"
              style={{
                padding: "0 4px 0 8px",
                ...props.shell(),
              }}
            >
              <span class="truncate text-13-medium text-text-strong">{language.t("prompt.mode.shell")}</span>
              <div class="size-4 shrink-0" />
            </div>
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <div data-component="prompt-agent-control">
                <TooltipKeybind
                  placement="top"
                  gutter={4}
                  title={language.t("command.agent.cycle")}
                  keybind={command.keybind("agent.cycle")}
                >
                  <Select
                    size="normal"
                    options={props.agentNames()}
                    current={local.agent.current()?.name ?? ""}
                    onSelect={local.agent.set}
                    class="capitalize max-w-[160px] text-text-base"
                    valueClass="truncate text-13-regular text-text-base"
                    triggerStyle={props.control()}
                    triggerProps={{ "data-action": "prompt-agent" }}
                    variant="ghost"
                  />
                </TooltipKeybind>
              </div>
              <div data-component="prompt-model-control">
                <Show
                  when={props.providersConnected() > 0}
                  fallback={
                    <TooltipKeybind
                      placement="top"
                      gutter={4}
                      title={language.t("command.model.choose")}
                      keybind={command.keybind("model.choose")}
                    >
                      <Button
                        data-action="prompt-model"
                        as="div"
                        variant="ghost"
                        size="normal"
                        class="min-w-0 max-w-[320px] text-13-regular text-text-base group"
                        style={props.control()}
                        onClick={() => dialog.show(() => <DialogSelectModelUnpaid />)}
                      >
                        <Show when={local.model.current()?.provider?.id}>
                          <ProviderIcon
                            id={local.model.current()!.provider.id}
                            class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                            style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                          />
                        </Show>
                        <span class="truncate">
                          {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                        </span>
                        <Icon name="chevron-down" size="small" class="shrink-0" />
                      </Button>
                    </TooltipKeybind>
                  }
                >
                  <TooltipKeybind
                    placement="top"
                    gutter={4}
                    title={language.t("command.model.choose")}
                    keybind={command.keybind("model.choose")}
                  >
                    <ModelSelectorPopover
                      model={local.model}
                      triggerAs={Button}
                      triggerProps={{
                        variant: "ghost",
                        size: "normal",
                        style: props.control(),
                        class: "min-w-0 max-w-[320px] text-13-regular text-text-base group",
                        "data-action": "prompt-model",
                      }}
                    >
                      <Show when={local.model.current()?.provider?.id}>
                        <ProviderIcon
                          id={local.model.current()!.provider.id}
                          class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                          style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                        />
                      </Show>
                      <span class="truncate">
                        {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                      </span>
                      <Icon name="chevron-down" size="small" class="shrink-0" />
                    </ModelSelectorPopover>
                  </TooltipKeybind>
                </Show>
              </div>
              <div data-component="prompt-variant-control">
                <TooltipKeybind
                  placement="top"
                  gutter={4}
                  title={language.t("command.model.variant.cycle")}
                  keybind={command.keybind("model.variant.cycle")}
                >
                  <Select
                    size="normal"
                    options={props.variants()}
                    current={local.model.variant.current() ?? "default"}
                    label={(x) => (x === "default" ? language.t("common.default") : x)}
                    onSelect={(x) => local.model.variant.set(x === "default" ? undefined : x)}
                    class="capitalize max-w-[160px] text-text-base"
                    valueClass="truncate text-13-regular text-text-base"
                    triggerStyle={props.control()}
                    triggerProps={{ "data-action": "prompt-model-variant" }}
                    variant="ghost"
                  />
                </TooltipKeybind>
              </div>
              <TooltipKeybind
                placement="top"
                gutter={8}
                title={props.acceptLabel()}
                keybind={command.keybind("permissions.autoaccept")}
              >
                <Button
                  data-action="prompt-permissions"
                  variant="ghost"
                  onClick={props.onToggleAccept}
                  classList={{
                    "h-7 w-7 p-0 shrink-0 flex items-center justify-center": true,
                    "text-text-base": !props.accepting(),
                    "hover:bg-surface-success-base": props.accepting(),
                  }}
                  style={props.control()}
                  aria-label={props.acceptLabel()}
                  aria-pressed={props.accepting()}
                >
                  <Icon name="shield" size="small" classList={{ "text-icon-success-base": props.accepting() }} />
                </Button>
              </TooltipKeybind>
            </div>
          </div>
        </div>
      </DockTray>
    </Show>
  )
}
