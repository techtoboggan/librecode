import { Button } from "@librecode/ui/button"
import { useDialog } from "@librecode/ui/context/dialog"
import { Dialog } from "@librecode/ui/dialog"
import { List } from "@librecode/ui/list"
import { ProviderIcon } from "@librecode/ui/provider-icon"
import { type Component } from "solid-js"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogSelectProvider } from "./dialog-select-provider"
import { LocalServerWizard } from "./local-server-wizard"
import { useLanguage } from "@/context/language"

export const DialogSelectModelUnpaid: Component = () => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()

  return (
    <Dialog
      title={language.t("dialog.model.select.title")}
      class="overflow-y-auto [&_[data-slot=dialog-body]]:overflow-visible [&_[data-slot=dialog-body]]:flex-none"
    >
      <div class="px-2.5 pb-1.5">
        <LocalServerWizard />
      </div>
      <div class="px-1.5 pb-1.5">
        <div class="w-full rounded-sm border border-border-weak-base bg-surface-raised-base">
          <div class="w-full flex flex-col items-start gap-4 px-1.5 pt-4 pb-4">
            <div class="px-2 text-14-medium text-text-base">{language.t("dialog.model.unpaid.addMore.title")}</div>
            <div class="w-full">
              <List
                class="w-full px-0"
                key={(x) => x?.id}
                items={providers.popular}
                activeIcon="plus-small"
                sortBy={(a, b) => {
                  if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
                    return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
                  return a.name.localeCompare(b.name)
                }}
                onSelect={(x) => {
                  if (!x) return
                  dialog.show(() => <DialogConnectProvider provider={x.id} />)
                }}
              >
                {(i) => (
                  <div class="w-full flex items-center gap-x-3">
                    <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
                    <span>{i.name}</span>
                  </div>
                )}
              </List>
              <Button
                variant="ghost"
                class="w-full justify-start px-[11px] py-3.5 gap-4.5 text-14-medium"
                icon="dot-grid"
                onClick={() => {
                  dialog.show(() => <DialogSelectProvider />)
                }}
              >
                {language.t("dialog.provider.viewAll")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
