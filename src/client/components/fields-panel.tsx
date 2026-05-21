import { useState } from "react";
import { EyeOff, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  fieldLabel,
  isFieldLocked,
  type Attribute,
  type ContentType,
} from "@/lib/content-types";
import { api } from "@/lib/api";
import { FieldEditor, TYPE_ICON, TYPE_LABEL } from "./field-editor";
import { cn } from "@/lib/utils";

export function FieldsPanel({
  contentType,
  onChange,
}: {
  contentType: ContentType;
  onChange: () => void;
}) {
  return (
    <div className="px-1.5 py-1">
      <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {contentType.info.displayName} schema
      </div>
      {Object.entries(contentType.attributes).map(([key, attr]) => (
        <FieldRow
          key={key}
          contentType={contentType}
          fieldKey={key}
          attribute={attr}
          onChange={onChange}
        />
      ))}
      <p className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground">
        Use the … menu on the library row to add fields.
      </p>
    </div>
  );
}

function FieldRow({
  contentType,
  fieldKey,
  attribute,
  onChange,
}: {
  contentType: ContentType;
  fieldKey: string;
  attribute: Attribute;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = TYPE_ICON[attribute.type];
  const locked = isFieldLocked(attribute);
  const label = fieldLabel(fieldKey, attribute);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-sidebar-accent/60 text-left",
            attribute.hidden && "opacity-50",
          )}
        >
          <Icon className="size-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1 truncate">{label}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {TYPE_LABEL[attribute.type]}
          </span>
          {attribute.hidden && <EyeOff className="size-3 text-muted-foreground" />}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-80 p-0">
        <FieldEditor
          fieldKey={fieldKey}
          attribute={attribute}
          siblingFieldKeys={Object.keys(contentType.attributes).filter((k) => k !== fieldKey)}
          onCommit={async (next) => {
            const isTypeChange = next.type !== attribute.type;
            const merged = { ...contentType.attributes, [fieldKey]: next };
            if (isTypeChange) {
              if (
                !window.confirm(
                  `Change "${fieldKey}" from ${attribute.type} to ${next.type}? Existing values may be coerced or wiped.`,
                )
              ) {
                return;
              }
              await api.patchContentType(contentType.uid, {
                attributes: merged,
                applyDestructive: true,
              });
            } else {
              await api.patchContentType(contentType.uid, { attributes: merged });
            }
            onChange();
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
