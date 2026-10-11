"use client";
import { useState, useTransition, useId, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  csvRows,
  parseHistoryCsv,
  historyCoverage,
  type CsvColumns,
  type HistoryInput,
} from "@/lib/fibonacci-history";
import { FIB_TIMEFRAMES } from "@/lib/fibonacci";
import {
  importHistory,
  copyStoredHistory,
  readHistory,
} from "@/app/actions/fibonacci-history";
export type HistorySummary = {
  id: string;
  stockId: number;
  interval: string;
  source: string;
  currency: string;
  count: number;
  from: number;
  to: number;
};
function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={options.map((value) => ({ value, label: value }))}
        value={value || null}
        onValueChange={(v) => onChange(String(v ?? ""))}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Auswählen" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((v) => (
              <SelectItem value={v} key={v}>
                {v}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
export function FibonacciHistoryPanel({
  stockId,
  histories,
}: {
  stockId?: number;
  histories: HistorySummary[];
}) {
  const router = useRouter(),
    prefix = useId();
  const [text, setText] = useState(""),
    [columns, setColumns] = useState<CsvColumns>({
      time: "time",
      open: "open",
      high: "high",
      low: "low",
      close: "close",
    }),
    [meta, setMeta] = useState({
      interval: "1d",
      timezone: "UTC",
      currency: "",
      source: "",
    }),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [preview, setPreview] = useState<HistoryInput | null>(null),
    [selected, setSelected] = useState<Awaited<
      ReturnType<typeof readHistory>
    > | null>(null),
    [error, setError] = useState(""),
    [pending, start] = useTransition(),
    [id, setId] = useState(() => crypto.randomUUID());
  const headers = useMemo(() => {
    try {
      return text ? csvRows(text)[0] : [];
    } catch {
      return [];
    }
  }, [text]);
  const loadCsv = (t: string) => {
    setError("");
    setPreview(null);
    setSelected(null);
    setText(t);
    setId(crypto.randomUUID());
    if (!t) return;
    try {
      const h = csvRows(t)[0];
      const pick = (key: string) => h.find((v) => v.toLowerCase() === key) || "";
      setColumns({
        time: pick("time") || pick("date") || pick("datetime"),
        open: pick("open"), high: pick("high"), low: pick("low"),
        close: pick("close"), volume: pick("volume"),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const input = () => ({ ...meta, stockId: stockId! });
  const change = (key: keyof typeof meta, value: string) => {
    setMeta((m) => ({ ...m, [key]: value }));
    setPreview(null);
    setId(crypto.randomUUID());
  };
  const execute = (task: () => Promise<void>) => {
    setError("");
    start(async () => {
      try {
        await task();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };
  const visible = selected?.candles ?? preview?.candles ?? [];
  const coverage = historyCoverage(
    visible,
    selected?.interval ?? meta.interval,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historische Kurse</CardTitle>
        <CardDescription>
          Vorhandene Kerzen oder CSV · eigene unveränderliche
          Forschungsdatensätze · keine Anbieterabfrage
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!stockId ? (
          <p className="text-sm text-muted-foreground">
            Wähle oben ein Instrument, um Kurse zuzuordnen.
          </p>
        ) : (
          <>
            <FieldGroup className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Pick
                label="Kursintervall"
                value={meta.interval}
                options={FIB_TIMEFRAMES.filter((v) => v !== "unbekannt")}
                onChange={(v) => change("interval", v)}
              />
              {(["timezone", "currency", "source"] as const).map((k) => (
                <Field key={k}>
                  <FieldLabel htmlFor={prefix + k}>
                    {
                      {
                        timezone: "Zeitzone (z. B. Europe/Berlin)",
                        currency: "Kurswährung",
                        source: "Quelle / Kursbasis (bereinigt?)",
                      }[k]
                    }
                  </FieldLabel>
                  <Input
                    id={prefix + k}
                    value={meta[k]}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </Field>
              ))}
            </FieldGroup>
            <Field>
              <FieldLabel htmlFor={prefix + "csv"}>
                CSV-Datei (max. 8 MB, 20.000 Kerzen)
              </FieldLabel>
              <Input
                id={prefix + "csv"}
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  setError("");
                  setPreview(null);
                  setSelected(null);
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 8_000_000) {
                    setError("CSV ist größer als 8 MB.");
                    return;
                  }
                  const t = await file.text();
                  loadCsv(t);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={prefix + "csv-text"}>CSV-Inhalt einfügen (alternativ zur Datei)</FieldLabel>
              <Textarea id={prefix + "csv-text"} value={text} onChange={(e) => loadCsv(e.target.value)}
                placeholder="time,open,high,low,close,volume" rows={4} />
            </Field>
            {!!headers.length && (
              <>
                <FieldGroup className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {(
                    ["time", "open", "high", "low", "close", "volume"] as const
                  ).map((k) => (
                    <Pick
                      key={k}
                      label={k === "volume" ? "Volumen (optional)" : k}
                      value={columns[k] || "Ohne"}
                      options={[
                        ...(k === "volume" ? ["Ohne"] : []),
                        ...headers,
                      ]}
                      onChange={(v) => {
                        setColumns((c) => ({
                          ...c,
                          [k]: v === "Ohne" ? "" : v,
                        }));
                        setPreview(null);
                        setId(crypto.randomUUID());
                      }}
                    />
                  ))}
                </FieldGroup>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setError("");
                      setSelected(null);
                      try {
                        setPreview(parseHistoryCsv(text, columns, input()));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    CSV prüfen
                  </Button>
                  <Button
                    disabled={pending || !preview}
                    onClick={() =>
                      execute(async () => {
                        setSelected(
                          await importHistory(id, text, columns, input()),
                        );
                        toast.success(
                          "Kursdatensatz gespeichert und zurückgelesen.",
                        );
                        router.refresh();
                      })
                    }
                  >
                    CSV speichern
                  </Button>
                </div>
              </>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor={prefix + "from"}>
                  Speicherzeitraum von (UTC)
                </FieldLabel>
                <Input
                  id={prefix + "from"}
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setId(crypto.randomUUID());
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={prefix + "to"}>Bis (UTC)</FieldLabel>
                <Input
                  id={prefix + "to"}
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setId(crypto.randomUUID());
                  }}
                />
              </Field>
              <Button
                className="self-end"
                variant="outline"
                disabled={pending || !from || !to}
                onClick={() =>
                  execute(async () => {
                    setPreview(null);
                    setSelected(
                      await copyStoredHistory(
                        id,
                        input(),
                        Date.parse(from + "T00:00:00Z") / 1000,
                        Date.parse(to + "T23:59:59Z") / 1000,
                      ),
                    );
                    toast.success(
                      "Vorhandene Kurse als Forschungsdatensatz zurückgelesen.",
                    );
                    router.refresh();
                  })
                }
              >
                Speicher übernehmen
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {histories
            .filter((h) => !stockId || h.stockId === stockId)
            .map((h) => (
              <Button
                key={h.id}
                variant="outline"
                className="h-auto justify-start whitespace-normal text-left"
                disabled={pending}
                onClick={() =>
                  execute(async () => {
                    setPreview(null);
                    setSelected(await readHistory(h.id));
                  })
                }
              >
                {h.source} · {h.interval} · {h.count} Kerzen · {h.currency} ·{" "}
                {new Date(h.from * 1000).toLocaleDateString("de-DE")}–
                {new Date(h.to * 1000).toLocaleDateString("de-DE")}
              </Button>
            ))}
        </div>
        {!!visible.length && (
          <>
            <p className="text-xs text-muted-foreground">
              {selected
                ? "Gespeicherter Datensatz " + selected.id
                : "Vorschau – noch nicht gespeichert"}{" "}
              · {coverage.count} Kerzen ·{" "}
              {coverage.discontinuities ?? "nicht geprüft"} größere
              Zeitabstände. {coverage.note}
            </p>
            <div
              className="h-56 w-full min-w-0"
              aria-label="Historischer Schlusskurs"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={visible.map((c) => ({ time: c.time, close: c.close }))}
                >
                  <XAxis
                    dataKey="time"
                    tickFormatter={(v) =>
                      new Date(v * 1000).toLocaleDateString("de-DE")
                    }
                  />
                  <YAxis domain={["auto", "auto"]} />
                  <Tooltip
                    labelFormatter={(v) =>
                      new Date(Number(v) * 1000).toLocaleString("de-DE", {
                        timeZone: "UTC",
                      })
                    }
                  />
                  <Line
                    type="linear"
                    dataKey="close"
                    stroke="var(--primary)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="text-left text-muted-foreground">
                  Erste 12 Kerzen · Zeit in UTC
                </caption>
                <thead>
                  <tr>
                    {["Zeit", "Open", "High", "Low", "Close", "Volumen"].map(
                      (v) => (
                        <th key={v} className="text-left">
                          {v}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 12).map((c) => (
                    <tr key={c.time}>
                      <td>{new Date(c.time * 1000).toISOString()}</td>
                      {[c.open, c.high, c.low, c.close, c.volume].map(
                        (v, i) => (
                          <td key={i}>{v}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
