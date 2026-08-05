<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import { usePluginSchemaFormApi } from '@/components/settings/plugin-schema/injection'

defineProps<{
  field: PluginSettingsFieldSchema
}>()

const form = usePluginSchemaFormApi()
</script>

<template>
  <div class="plugin-object-list">
    <div class="text-body-2 font-weight-medium mb-1">
      {{ form.labelFor(field) }}
    </div>
    <p
      v-if="form.hintFor(field)"
      class="text-caption text-medium-emphasis mb-3"
    >
      {{ form.hintFor(field) }}
    </p>
    <v-expansion-panels
      multiple
      class="plugin-object-list__panels mb-3"
    >
      <v-expansion-panel
        v-for="(item, index) in form.objectListItems(field)"
        :key="form.objectListPanelKey(field, index)"
        class="plugin-object-list__item"
      >
        <v-expansion-panel-title class="text-subtitle-2 py-2">
          <span class="text-truncate">{{ form.objectListItemTitle(item, index) }}</span>
        </v-expansion-panel-title>
        <v-expansion-panel-text class="plugin-object-list__body pt-2">
          <div class="d-flex flex-column ga-4">
            <div
              v-for="sub in field.itemFields ?? []"
              :key="sub.key"
              class="plugin-object-list__field"
            >
              <v-switch
                v-if="sub.type === 'boolean'"
                :model-value="Boolean(item[sub.key])"
                :label="form.itemLabelFor(sub)"
                :hint="form.itemHintFor(sub)"
                persistent-hint
                color="primary"
                hide-details="auto"
                @update:model-value="
                  form.updateObjectListItem(field, index, sub.key, $event)
                "
              />
              <v-text-field
                v-else-if="sub.type === 'string'"
                :model-value="
                  form.deferTextCommit.value
                    ? form.textDraftGet(
                        form.objectListTextDraftKey(field.key, index, sub.key),
                        item[sub.key],
                      )
                    : String(item[sub.key] ?? '')
                "
                :label="form.itemLabelFor(sub)"
                :hint="form.itemHintFor(sub)"
                persistent-hint
                variant="outlined"
                density="compact"
                hide-details="auto"
                @update:model-value="
                  form.onTextInput(
                    form.objectListTextDraftKey(field.key, index, sub.key),
                    $event,
                    () => item[sub.key],
                    (v) => form.updateObjectListItem(field, index, sub.key, v),
                  )
                "
                @blur="
                  form.onTextBlur(
                    form.objectListTextDraftKey(field.key, index, sub.key),
                    () => item[sub.key],
                    (v) => form.updateObjectListItem(field, index, sub.key, v),
                  )
                "
              />
              <v-text-field
                v-else-if="sub.type === 'integer' || sub.type === 'number'"
                :model-value="item[sub.key]"
                type="number"
                :label="form.itemLabelFor(sub)"
                :hint="form.itemHintFor(sub)"
                persistent-hint
                variant="outlined"
                density="compact"
                hide-details="auto"
                :min="sub.min"
                :max="sub.max"
                @update:model-value="
                  form.updateObjectListItem(field, index, sub.key, $event)
                "
              />
              <v-select
                v-else-if="sub.type === 'enum'"
                :model-value="String(item[sub.key] ?? '')"
                :items="form.itemEnumItems(sub)"
                item-title="title"
                item-value="value"
                :label="form.itemLabelFor(sub)"
                :hint="form.itemHintFor(sub)"
                persistent-hint
                variant="outlined"
                density="compact"
                hide-details="auto"
                @update:model-value="
                  form.updateObjectListItem(field, index, sub.key, $event)
                "
              />
              <div
                v-else-if="sub.type === 'text' && sub.widget === 'promptTemplate'"
                class="plugin-prompt-template"
              >
                <v-textarea
                  :model-value="
                    form.deferTextCommit.value
                      ? form.textDraftGet(
                          form.objectListTextDraftKey(field.key, index, sub.key),
                          form.displayTextValue(sub, item[sub.key]),
                        )
                      : form.displayTextValue(sub, item[sub.key])
                  "
                  :label="form.itemLabelFor(sub)"
                  :hint="form.itemHintFor(sub)"
                  persistent-hint
                  variant="outlined"
                  density="compact"
                  auto-grow
                  rows="3"
                  :max-rows="12"
                  hide-details="auto"
                  @update:model-value="
                    form.onTextInput(
                      form.objectListTextDraftKey(field.key, index, sub.key),
                      $event,
                      () => form.displayTextValue(sub, item[sub.key]),
                      (v) => form.updateObjectListItem(field, index, sub.key, v),
                    )
                  "
                  @blur="
                    form.onTextBlur(
                      form.objectListTextDraftKey(field.key, index, sub.key),
                      () => form.displayTextValue(sub, item[sub.key]),
                      (v) => form.updateObjectListItem(field, index, sub.key, v),
                    )
                  "
                />
                <v-btn
                  v-if="sub.defaultKey"
                  variant="tonal"
                  color="primary"
                  size="small"
                  prepend-icon="mdi-backup-restore"
                  class="mt-1 text-none"
                  @click="
                    form.restoreDefaultPrompt(sub, (v) =>
                      form.updateObjectListItem(field, index, sub.key, v),
                    )
                  "
                >
                  {{ form.restoreDefaultLabel() }}
                </v-btn>
              </div>
              <v-textarea
                v-else-if="sub.type === 'text'"
                :model-value="
                  form.deferTextCommit.value
                    ? form.textDraftGet(
                        form.objectListTextDraftKey(field.key, index, sub.key),
                        item[sub.key],
                      )
                    : String(item[sub.key] ?? '')
                "
                :label="form.itemLabelFor(sub)"
                :hint="form.itemHintFor(sub)"
                persistent-hint
                variant="outlined"
                density="compact"
                auto-grow
                rows="3"
                :max-rows="12"
                hide-details="auto"
                @update:model-value="
                  form.onTextInput(
                    form.objectListTextDraftKey(field.key, index, sub.key),
                    $event,
                    () => item[sub.key],
                    (v) => form.updateObjectListItem(field, index, sub.key, v),
                  )
                "
                @blur="
                  form.onObjectListTextBlur(
                    field,
                    index,
                    sub,
                    () => item[sub.key],
                    (v) => form.updateObjectListItem(field, index, sub.key, v),
                  )
                "
              />
            </div>
            <div class="plugin-object-list__remove">
              <v-btn
                variant="outlined"
                color="error"
                size="small"
                prepend-icon="mdi-delete-outline"
                class="text-none"
                @click="form.requestRemoveObjectListItem(field, index)"
              >
                {{ form.removeItemLabel() }}
              </v-btn>
            </div>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <v-btn
      variant="tonal"
      color="primary"
      size="small"
      prepend-icon="mdi-plus"
      class="text-none"
      @click="form.addObjectListItem(field)"
    >
      {{ form.addObjectListLabel() }}
    </v-btn>
  </div>
</template>

<style scoped>
.plugin-object-list__panels {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  overflow: hidden;
}
.plugin-object-list__body :deep(.v-input) {
  margin-bottom: 2px;
}
.plugin-object-list__field + .plugin-object-list__field {
  margin-top: 2px;
}
.plugin-prompt-template :deep(.v-btn) {
  margin-bottom: 4px;
}
.plugin-object-list__remove {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
