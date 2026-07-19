"use client"

import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox"

export type MultiSelectOption = { value: string; label: string }

export function MultiSelectFilter({
  placeholder,
  options,
  value,
  onChange,
  disabled,
}: {
  placeholder: string
  options: MultiSelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const selected = options.filter((o) => value.includes(o.value))

  return (
    <Combobox
      items={options}
      multiple
      value={selected}
      onValueChange={(next) => onChange(next.map((o) => o.value))}
      itemToStringLabel={(o) => o.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
    >
      <ComboboxInputGroup className={disabled ? "opacity-50" : undefined}>
        <ComboboxChips>
          <ComboboxValue>
            {(items: MultiSelectOption[]) => (
              <>
                {items.map((item) => (
                  <ComboboxChip key={item.value} aria-label={item.label}>
                    {item.label}
                    <ComboboxChipRemove aria-label={`Remove ${item.label}`} />
                  </ComboboxChip>
                ))}
                <ComboboxInput
                  placeholder={items.length > 0 ? "" : placeholder}
                  disabled={disabled}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
      </ComboboxInputGroup>

      <ComboboxContent>
        <ComboboxEmpty>No matches.</ComboboxEmpty>
        <ComboboxList>
          {(option: MultiSelectOption) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
