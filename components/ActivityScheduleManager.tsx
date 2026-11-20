import React, { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, Clock, Edit2, MapPin, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

export interface ActivitySchedule {
  id: string;
  name: string;
  activityType: "senam" | "apel";
  locationName: string;
  coordinates: string;
  radius: number;
  day: string;
  time: string;
  isActive: boolean;
}

const DAYS = [
  "Setiap Hari",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
];

function computeWindowLabel(timeStr: string) {
  if (!timeStr || !timeStr.includes(":")) return "-";
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return "-";
  const startTotal = (h * 60 + m - 60 + 1440) % 1440;
  const endTotal = (h * 60 + m + 60) % 1440;
  const fmt = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  return `${fmt(startTotal)} - ${fmt(endTotal)}`;
}

export default function ActivityScheduleManager({
  onSchedulesChanged,
}: {
  onSchedulesChanged?: (schedules: ActivitySchedule[]) => void;
}) {
  const [schedules, setSchedules] = useState<ActivitySchedule[]>([]);
  const [locations, setLocations] = useState<{ id: string; desa: string; coordinates: string }[]>([]);
  const [mainLocation, setMainLocation] = useState<string>("-7.250445, 112.768845");
  const [loading, setLoading] = useState(false);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activityType, setActivityType] = useState<"senam" | "apel">("senam");
  const [name, setName] = useState("Senam Pagi");
  const [locationPreset, setLocationPreset] = useState("Kantor Induk");
  const [customLocationName, setCustomLocationName] = useState("");
  const [coordinates, setCoordinates] = useState("");
  const [radius, setRadius] = useState("200");
  const [day, setDay] = useState("Jumat");
  const [time, setTime] = useState("07:00");
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [schedRes, locRes, setRes] = await Promise.all([
        fetch("/api/activity-schedules"),
        fetch("/api/locations"),
        fetch("/api/settings"),
      ]);

      if (schedRes.ok) {
        const data = await schedRes.json();
        setSchedules(data);
        onSchedulesChanged?.(data);
      }
      if (locRes.ok) {
        const locData = await locRes.json();
        setLocations(locData);
      }
      if (setRes.ok) {
        const setData = await setRes.json();
        if (setData?.generalSettings?.mainLocation) {
          setMainLocation(setData.generalSettings.mainLocation);
        }
      }
    } catch (err) {
      console.error("Failed loading activity schedules:", err);
      toast.error("Gagal memuat jadwal kegiatan");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setActivityType("senam");
    setName("Senam Pagi");
    setLocationPreset("Kantor Induk");
    setCustomLocationName("");
    setCoordinates(mainLocation);
    setRadius("200");
    setDay("Jumat");
    setTime("07:00");
    setIsActive(true);
  };

  const openAddDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (sched: ActivitySchedule) => {
    setEditingId(sched.id);
    setActivityType(sched.activityType || "senam");
    setName(sched.name);
    const matchingLoc = locations.find(
      (l) => (l.desa || "").toLowerCase() === (sched.locationName || "").toLowerCase()
    );
    if (sched.locationName === "Kantor Induk") {
      setLocationPreset("Kantor Induk");
      setCustomLocationName("");
    } else if (matchingLoc) {
      setLocationPreset(matchingLoc.id);
      setCustomLocationName("");
    } else {
      setLocationPreset("__custom__");
      setCustomLocationName(sched.locationName || "");
    }
    setCoordinates(sched.coordinates || mainLocation);
    setRadius(String(sched.radius || 200));
    setDay(sched.day || "Jumat");
    setTime(sched.time || "07:00");
    setIsActive(sched.isActive);
    setIsDialogOpen(true);
  };

  const handleActivityTypeChange = (val: string) => {
    const t = val === "apel" ? "apel" : "senam";
    setActivityType(t);
    if (!editingId) {
      if (t === "senam" && (!name || name === "Upacara Apel")) {
        setName("Senam Pagi");
        setDay("Jumat");
      } else if (t === "apel" && (!name || name === "Senam Pagi")) {
        setName("Upacara Apel");
        setDay("Senin");
      }
    }
  };

  const handleLocationPresetChange = (val: string) => {
    setLocationPreset(val);
    if (val === "Kantor Induk") {
      setCoordinates(mainLocation);
    } else if (val === "__custom__") {
      if (!coordinates) setCoordinates(mainLocation);
    } else {
      const found = locations.find((l) => String(l.id) === String(val));
      if (found) {
        setCoordinates(found.coordinates || mainLocation);
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedLocationName =
      locationPreset === "Kantor Induk"
        ? "Kantor Induk"
        : locationPreset === "__custom__"
          ? customLocationName.trim() || "Lokasi Kustom"
          : locations.find((l) => String(l.id) === String(locationPreset))?.desa || "Kantor Induk";

    const resolvedCoords = (coordinates || mainLocation).trim();

    if (!name.trim()) {
      toast.error("Nama kegiatan wajib diisi");
      return;
    }
    if (!day) {
      toast.error("Hari pelaksanaan wajib dipilih");
      return;
    }
    if (!time) {
      toast.error("Jam pelaksanaan wajib diisi");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        activityType,
        locationName: resolvedLocationName,
        coordinates: resolvedCoords,
        radius: parseInt(radius || "200", 10) || 200,
        day,
        time,
        isActive,
      };

      const res = await fetch(
        editingId ? `/api/activity-schedules/${editingId}` : "/api/activity-schedules",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Gagal menyimpan jadwal kegiatan");
      }

      toast.success(
        editingId ? "Jadwal kegiatan berhasil diperbarui" : "Jadwal kegiatan berhasil disimpan"
      );
      setIsDialogOpen(false);
      await fetchAll();
    } catch (err: any) {
      toast.error(err.message || "Terjadi kesalahan saat menyimpan jadwal");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (sched: ActivitySchedule) => {
    try {
      const res = await fetch(`/api/activity-schedules/${sched.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !sched.isActive }),
      });
      if (!res.ok) throw new Error("Gagal mengubah status jadwal");
      toast.success(
        !sched.isActive
          ? `Jadwal "${sched.name}" diaktifkan`
          : `Jadwal "${sched.name}" dinonaktifkan`
      );
      await fetchAll();
    } catch (err: any) {
      toast.error(err.message || "Gagal memperbarui status");
    }
  };

  const handleDelete = async (id: string, schedName: string) => {
    try {
      const res = await fetch(`/api/activity-schedules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal menghapus jadwal");
      toast.success(`Jadwal "${schedName}" dihapus`);
      await fetchAll();
    } catch (err: any) {
      toast.error(err.message || "Gagal menghapus jadwal");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle>Jadwal Kegiatan Senam Pagi &amp; Upacara Apel</CardTitle>
          <CardDescription>
            Fitur absen akan otomatis muncul di dashboard user 1 jam sebelum hingga 1 jam sesudah jadwal yang diaktifkan, khusus dalam radius 200 m dari lokasi yang ditentukan.
          </CardDescription>
        </div>
        <Button onClick={openAddDialog} className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Tambah Jadwal Kegiatan
        </Button>
      </CardHeader>
      <CardContent>
        {loading && schedules.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-500">Memuat jadwal kegiatan...</div>
        ) : schedules.length === 0 ? (
          <div className="text-center py-10 border rounded-lg border-dashed text-slate-500 text-sm">
            Belum ada jadwal Senam Pagi atau Upacara Apel. Klik <strong>Tambah Jadwal Kegiatan</strong> untuk membuat jadwal baru.
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama Kegiatan</TableHead>
                  <TableHead>Lokasi &amp; Radius</TableHead>
                  <TableHead>Hari &amp; Jam</TableHead>
                  <TableHead>Jendela Aktif</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((sched) => (
                  <TableRow key={sched.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{sched.name}</div>
                      <span
                        className={`inline-block mt-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          sched.activityType === "apel"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-teal-100 text-teal-700"
                        }`}
                      >
                        {sched.activityType === "apel" ? "Upacara Apel" : "Senam Pagi"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                        <MapPin className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span>{sched.locationName || "Kantor Induk"}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Radius {sched.radius || 200} m • {sched.coordinates || mainLocation}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-slate-800">
                        <Calendar className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <span>{sched.day}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>{sched.time} WIB</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                      {computeWindowLabel(sched.time)} WIB
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(sched)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          sched.isActive
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                            : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                        }`}
                      >
                        <Power className="h-3 w-3" />
                        {sched.isActive ? "Aktif" : "Nonaktif"}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(sched)}
                          title="Edit jadwal"
                        >
                          <Edit2 className="h-4 w-4 text-slate-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(sched.id, sched.name)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          title="Hapus jadwal"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Jadwal Kegiatan" : "Tambah Jadwal Kegiatan"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="act-type">Kategori Sheet Kegiatan</Label>
              <Select value={activityType} onValueChange={handleActivityTypeChange}>
                <SelectTrigger id="act-type">
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="senam">Senam Pagi (Sheet AbsensiSenam)</SelectItem>
                  <SelectItem value="apel">Upacara Apel (Sheet AbsensiApel)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="act-name">Nama Kegiatan</Label>
              <Input
                id="act-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Senam Pagi atau Upacara Apel"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="act-location">Lokasi</Label>
              <Select value={locationPreset} onValueChange={handleLocationPresetChange}>
                <SelectTrigger id="act-location">
                  <SelectValue placeholder="Pilih lokasi kegiatan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Kantor Induk">Kantor Induk ({mainLocation})</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>
                      {loc.desa || "Lokasi"} ({loc.coordinates || "-"})
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">Tempat Lain (Input Manual)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {locationPreset === "__custom__" && (
              <div className="space-y-2">
                <Label htmlFor="act-custom-loc">Nama Tempat / Lokasi</Label>
                <Input
                  id="act-custom-loc"
                  value={customLocationName}
                  onChange={(e) => setCustomLocationName(e.target.value)}
                  placeholder="Contoh: Lapangan Kecamatan"
                  required
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="act-coords">Koordinat Lokasi</Label>
                <Input
                  id="act-coords"
                  value={coordinates}
                  onChange={(e) => setCoordinates(e.target.value)}
                  placeholder="-7.250445, 112.768845"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="act-radius">Radius (meter)</Label>
                <Input
                  id="act-radius"
                  type="number"
                  min={10}
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="act-day">Hari</Label>
                <Select value={day} onValueChange={setDay}>
                  <SelectTrigger id="act-day">
                    <SelectValue placeholder="Pilih hari" />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="act-time">Jam</Label>
                <Input
                  id="act-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Fitur absensi kegiatan akan muncul 1 jam sebelum jam {time || "07:00"} hingga 1 jam sesudahnya ({computeWindowLabel(time)} WIB).
            </p>

            <div className="flex items-center space-x-2 pt-1">
              <input
                type="checkbox"
                id="act-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 relative cursor-pointer
                  appearance-none checked:bg-teal-600 checked:border-transparent
                  after:content-[''] after:hidden checked:after:block
                  after:absolute after:left-[4px] after:top-0.5 after:w-[5px] after:h-[10px]
                  after:border-r-2 after:border-b-2 after:border-white after:rotate-45"
              />
              <Label htmlFor="act-active" className="cursor-pointer">
                Aktifkan jadwal kegiatan ini
              </Label>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {isSaving ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
