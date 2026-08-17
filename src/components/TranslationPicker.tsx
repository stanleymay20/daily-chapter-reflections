import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BibleVersion } from "@/lib/youversion";

export function TranslationPicker({
  bibles,
  value,
  onChange,
}: {
  bibles: BibleVersion[];
  value?: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select {...(value ? { value } : {})} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-full max-w-[240px] text-sm" aria-label="Translation">
        <SelectValue placeholder="Choose translation" />
      </SelectTrigger>
      <SelectContent>
        {bibles.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.abbreviation || b.name} {b.language ? `· ${b.language}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
