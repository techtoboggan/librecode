import { Component, Show, createSignal } from "solid-js"
import { useDialog } from "@librecode/ui/context/dialog"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@librecode/ui/dialog"
import { List } from "@librecode/ui/list"
import { Tag } from "@librecode/ui/tag"
import { ProviderIcon } from "@librecode/ui/provider-icon"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { LocalServerWizard } from "./local-server-wizard"
import { Collapsible } from "@librecode/ui/collapsible"
import { Icon } from "@librecode/ui/icon"

const CUSTOM_ID = "_custom"

export const DialogSelectProvider: Component = () => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()

  const [localServersOpen, setLocalServersOpen] = createSignal(false)

  const popularGroup = () => language.t("dialog.provider.group.popular")
  const otherGroup = () => language.t("dialog.provider.group.other")
  const customLabel = () => language.t("settings.providers.tag.custom")

  return (
    <Dialog title={language.t("command.provider.connect")} transition>
      <div class="px-2.5 pb-1">
        <Collapsible open={localServersOpen()} onOpenChange={setLocalServersOpen}>
          <Collapsible.Trigger class="flex items-center gap-1.5 w-full text-left text-12-medium text-text-weak hover:text-text-base px-1 py-1 rounded-md hover:bg-surface-hover transition-colors">
            <Icon name={localServersOpen() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0" />
            {language.t("dialog.provider.local.servers")}
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div class="pb-2">
              <LocalServerWizard />
            </div>
          </Collapsible.Content>
        </Collapsible>
      </div>
      <List
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          return [{ id: CUSTOM_ID, name: customLabel() }, ...providers.all()]
        }}
        filterKeys={["id", "name"]}
        groupBy={(x) => (popularProviders.includes(x.id) ? popularGroup() : otherGroup())}
        sortBy={(a, b) => {
          if (a.id === CUSTOM_ID) return -1
          if (b.id === CUSTOM_ID) return 1
          if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
            return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          const popular = popularGroup()
          if (a.category === popular && b.category !== popular) return -1
          if (b.category === popular && a.category !== popular) return 1
          return 0
        }}
        onSelect={(x) => {
          if (!x) return
          if (x.id === CUSTOM_ID) {
            dialog.show(() => <DialogCustomProvider back="providers" />)
            return
          }
          dialog.show(() => <DialogConnectProvider provider={x.id} />)
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
            <span>{i.name}</span>
            <Show when={i.id === CUSTOM_ID}>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
