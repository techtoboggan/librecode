import { type JSX, Show } from "solid-js"
import { Button } from "@librecode/ui/button"
import { Dialog } from "@librecode/ui/dialog"
import { DropdownMenu } from "@librecode/ui/dropdown-menu"
import { IconButton } from "@librecode/ui/icon-button"
import { InlineInput } from "@librecode/ui/inline-input"
import { Spinner } from "@librecode/ui/spinner"
import { TextField } from "@librecode/ui/text-field"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useDialog } from "@librecode/ui/context/dialog"
import { useLanguage } from "@/context/language"

export type TitleState = {
  draft: string
  editing: boolean
  saving: boolean
  menuOpen: boolean
  pendingRename: boolean
  pendingShare: boolean
}

export type ShareState = {
  open: boolean
  dismiss: "escape" | "outside" | null
}

export type SlotState = {
  open: boolean
  show: boolean
  fade: boolean
}

export type SessionHeaderProps = {
  centered: boolean
  sessionID: () => string | undefined
  titleValue: () => string | undefined
  shareUrl: () => string | undefined
  shareEnabled: () => boolean
  parentID: () => string | undefined
  slot: SlotState
  tint: () => string | null | undefined
  title: TitleState
  share: ShareState
  req: { share: boolean; unshare: boolean }
  moreRef: (el: HTMLButtonElement) => void
  titleInputRef: (el: HTMLInputElement) => void
  onNavigateParent: () => void
  onOpenTitleEditor: () => void
  onCloseTitleEditor: () => void
  onSaveTitleEditor: () => void
  onTitleInput: (value: string) => void
  onTitleMenuOpenChange: (open: boolean) => void
  onSelectRename: () => void
  onSelectShare: () => void
  onPendingRename: () => void
  onPendingShare: () => void
  onArchiveSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onShareSession: () => void
  onUnshareSession: () => void
  onViewShare: () => void
  onShareOpenChange: (open: boolean) => void
  onShareDismissEscape: () => void
  onShareDismissOutside: () => void
  onShareCloseAutoFocus: (event: Event) => void
}

export function SessionHeader(props: SessionHeaderProps): JSX.Element {
  const dialog = useDialog()
  const language = useLanguage()

  function DialogDeleteSession(innerProps: { sessionID: string }): JSX.Element {
    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: language.t("command.session.new") })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={async () => {
                await props.onDeleteSession(innerProps.sessionID)
                dialog.close()
              }}
            >
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <div
      data-session-title
      classList={{
        "sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]": true,
        "w-full": true,
        "pb-4": true,
        "pl-2 pr-3 md:pl-4 md:pr-3": true,
        "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
      }}
    >
      <div class="h-12 w-full flex items-center justify-between gap-2">
        <div class="flex items-center gap-1 min-w-0 flex-1 pr-3">
          <Show when={props.parentID()}>
            <IconButton
              tabIndex={-1}
              icon="arrow-left"
              variant="ghost"
              onClick={props.onNavigateParent}
              aria-label={language.t("common.goBack")}
            />
          </Show>
          <div class="flex items-center min-w-0 grow-1">
            <div
              class="shrink-0 flex items-center justify-center overflow-hidden transition-[width,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                width: props.slot.open ? "16px" : "0px",
                "margin-right": props.slot.open ? "8px" : "0px",
              }}
              aria-hidden="true"
            >
              <Show when={props.slot.show}>
                <div class="transition-opacity duration-200 ease-out" classList={{ "opacity-0": props.slot.fade }}>
                  <Spinner class="size-4" style={{ color: props.tint() ?? "var(--icon-interactive-base)" }} />
                </div>
              </Show>
            </div>
            <Show when={props.titleValue() || props.title.editing}>
              <Show
                when={props.title.editing}
                fallback={
                  <h1
                    class="text-14-medium text-text-strong truncate grow-1 min-w-0"
                    onDblClick={props.onOpenTitleEditor}
                  >
                    {props.titleValue()}
                  </h1>
                }
              >
                <InlineInput
                  ref={props.titleInputRef}
                  value={props.title.draft}
                  disabled={props.title.saving}
                  class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px]"
                  style={{ "--inline-input-shadow": "var(--shadow-xs-border-select)" }}
                  onInput={(event) => props.onTitleInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === "Enter") {
                      event.preventDefault()
                      props.onSaveTitleEditor()
                      return
                    }
                    if (event.key === "Escape") {
                      event.preventDefault()
                      props.onCloseTitleEditor()
                    }
                  }}
                  onBlur={props.onCloseTitleEditor}
                />
              </Show>
            </Show>
          </div>
        </div>
        <Show when={props.sessionID()}>
          {(id) => (
            <div class="shrink-0 flex items-center gap-3">
              <SessionContextUsage placement="bottom" />
              <DropdownMenu
                gutter={4}
                placement="bottom-end"
                open={props.title.menuOpen}
                onOpenChange={props.onTitleMenuOpenChange}
              >
                <DropdownMenu.Trigger
                  as={IconButton}
                  icon="dot-grid"
                  variant="ghost"
                  class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                  classList={{
                    "bg-surface-base-active": props.share.open || props.title.pendingShare,
                  }}
                  aria-label={language.t("common.moreOptions")}
                  aria-expanded={props.title.menuOpen || props.share.open || props.title.pendingShare}
                  ref={props.moreRef}
                />
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    style={{ "min-width": "104px" }}
                    onCloseAutoFocus={(event) => {
                      if (props.title.pendingRename) {
                        event.preventDefault()
                        props.onPendingRename()
                        return
                      }
                      if (props.title.pendingShare) {
                        event.preventDefault()
                        requestAnimationFrame(() => {
                          props.onPendingShare()
                        })
                      }
                    }}
                  >
                    <DropdownMenu.Item onSelect={props.onSelectRename}>
                      <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <Show when={props.shareEnabled()}>
                      <DropdownMenu.Item onSelect={props.onSelectShare}>
                        <DropdownMenu.ItemLabel>{language.t("session.share.action.share")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </Show>
                    <DropdownMenu.Item onSelect={() => props.onArchiveSession(id())}>
                      <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id()} />)}>
                      <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>

              <KobaltePopover
                open={props.share.open}
                anchorRef={props.moreRef as unknown as () => HTMLElement}
                placement="bottom-end"
                gutter={4}
                modal={false}
                onOpenChange={props.onShareOpenChange}
              >
                <KobaltePopover.Portal>
                  <KobaltePopover.Content
                    data-component="popover-content"
                    style={{ "min-width": "320px" }}
                    onEscapeKeyDown={(event) => {
                      props.onShareDismissEscape()
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onPointerDownOutside={props.onShareDismissOutside}
                    onFocusOutside={props.onShareDismissOutside}
                    onCloseAutoFocus={props.onShareCloseAutoFocus}
                  >
                    <div class="flex flex-col p-3">
                      <div class="flex flex-col gap-1">
                        <div class="text-13-medium text-text-strong">{language.t("session.share.popover.title")}</div>
                        <div class="text-12-regular text-text-weak">
                          {props.shareUrl()
                            ? language.t("session.share.popover.description.shared")
                            : language.t("session.share.popover.description.unshared")}
                        </div>
                      </div>
                      <div class="mt-3 flex flex-col gap-2">
                        <Show
                          when={props.shareUrl()}
                          fallback={
                            <Button
                              size="large"
                              variant="primary"
                              class="w-full"
                              onClick={props.onShareSession}
                              disabled={props.req.share}
                            >
                              {props.req.share
                                ? language.t("session.share.action.publishing")
                                : language.t("session.share.action.publish")}
                            </Button>
                          }
                        >
                          <div class="flex flex-col gap-2">
                            <TextField
                              value={props.shareUrl() ?? ""}
                              readOnly
                              copyable
                              copyKind="link"
                              tabIndex={-1}
                              class="w-full"
                            />
                            <div class="grid grid-cols-2 gap-2">
                              <Button
                                size="large"
                                variant="secondary"
                                class="w-full shadow-none border border-border-weak-base"
                                onClick={props.onUnshareSession}
                                disabled={props.req.unshare}
                              >
                                {props.req.unshare
                                  ? language.t("session.share.action.unpublishing")
                                  : language.t("session.share.action.unpublish")}
                              </Button>
                              <Button
                                size="large"
                                variant="primary"
                                class="w-full"
                                onClick={props.onViewShare}
                                disabled={props.req.unshare}
                              >
                                {language.t("session.share.action.view")}
                              </Button>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </KobaltePopover.Content>
                </KobaltePopover.Portal>
              </KobaltePopover>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
