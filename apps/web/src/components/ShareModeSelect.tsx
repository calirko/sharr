import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ShareMode } from "@/lib/api";

export function ShareModeSelect({ value, onChange }: { value: ShareMode; onChange: (v: ShareMode) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ShareMode)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="creator">Only me</SelectItem>
        <SelectItem value="everyone">Everyone</SelectItem>
      </SelectContent>
    </Select>
  );
}
