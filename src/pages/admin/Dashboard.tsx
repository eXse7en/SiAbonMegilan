import { getServerTime } from '@/lib/time';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, Clock, UserX, FileText } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

import { format } from 'date-fns';

export default function AdminDashboard() {
  const [appName, setAppName] = useState("Si Abon Megilan");
  const [companyName, setCompanyName] = useState("Puskesmas Sehat");

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/settings');
        if (response.ok) {
          const data = await response.json();
          if (data.generalSettings?.appName) setAppName(data.generalSettings.appName);
          if (data.generalSettings?.companyName) setCompanyName(data.generalSettings.companyName);
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error);
      }
    };
    fetchSettings();
  }, []);

  const [stats, setStats] = useState([
    { title: "Total Karyawan", value: "0", icon: Users, color: "text-blue-600", bg: "bg-blue-100" },
    { title: "Hadir Hari Ini", value: "0", icon: UserCheck, color: "text-emerald-600", bg: "bg-emerald-100" },
    { title: "Terlambat", value: "0", icon: Clock, color: "text-amber-600", bg: "bg-amber-100" },
    { title: "Belum Absen", value: "0", icon: UserX, color: "text-red-600", bg: "bg-red-100" },
  ]);

  const [pendingLeaves, setPendingLeaves] = useState<any[]>([]);
  const [notCheckedOut, setNotCheckedOut] = useState<any[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<{ url: string; title: string } | null>(null);

  const handleApprove = async (id: string, type: string, action: 'approve' | 'reject', currentStatus?: string) => {
    let finalStatus = 'Hadir';
    if (action === 'reject') {
      finalStatus = 'Ditolak';
    } else if (currentStatus === 'pending_telat' || type === 'in') {
      finalStatus = 'Hadir (Telat)';
    } else {
      if (type === 'izin') finalStatus = 'izin';
      else if (type === 'sakit') finalStatus = 'Sakit';
      else if (type === 'Cuti' || type === 'cuti') finalStatus = 'Cuti';
      else if (type === 'dinas_luar') finalStatus = 'Dinas Luar';
    }

    try {
      const res = await fetch(`/api/attendance/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: finalStatus })
      });
      if (res.ok) {
        setPendingLeaves(prev => prev.filter(l => l.id !== id));
        toast.success(action === 'approve' ? 'Permintaan disetujui' : 'Permintaan ditolak');
      } else {
        toast.error('Gagal memperbarui status persetujuan');
      }
    } catch (e) {
      console.error('Error updating leave status', e);
      toast.error('Terjadi kesalahan jaringan');
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        try {
          await fetch('/api/attendance/auto-checkout-check', { method: 'POST' });
        } catch (e) {
          if (e instanceof TypeError && e.message.includes('fetch')) {
            // Ignore
          } else {
            console.error('Failed auto-checkout check', e);
          }
        }
        
        const [empRes, attRes, setRes, shiftRes] = await Promise.all([
          fetch('/api/employees'),
          fetch('/api/attendance'),
          fetch('/api/settings'),
          fetch('/api/shifts')
        ]);
        
        const employees = empRes.ok ? await empRes.json() : [];
        const attendance = attRes.ok ? await attRes.json() : [];
        const shifts = shiftRes.ok ? await shiftRes.json() : [];
        let absensiSettings = { tolerance: "15" };
        
        if (setRes.ok) {
          const data = await setRes.json();
          if (data.generalSettings?.appName) setAppName(data.generalSettings.appName);
          if (data.generalSettings?.companyName) setCompanyName(data.generalSettings.companyName);
          if (data.absensiSettings) absensiSettings = data.absensiSettings;
        }

        const parseTime = (timeStr: string) => {
          if (!timeStr) return 0;
          let clean = timeStr.replace(/\./g, ':').trim().toUpperCase();
          let isPM = clean.includes('PM');
          let isAM = clean.includes('AM');
          clean = clean.replace(/[A-Z]/g, '').trim();
          const parts = clean.split(':');
          let h = parseInt(parts[0] || '0', 10);
          let m = parseInt(parts[1] || '0', 10);
          if (isPM && h !== 12) h += 12;
          if (isAM && h === 12) h = 0;
          return h * 60 + m;
        };

        const getShiftForTime = (timeMinutes: number, unit?: string) => {
          if (!shifts || shifts.length === 0) return { start: 8 * 60, end: 16 * 60, tolerance: parseInt(absensiSettings.tolerance || '15') };
          const activeShiftsRaw = shifts.filter((s: any) => s.isActive);
          const specificShifts = activeShiftsRaw.filter((s: any) => s.unit && s.unit === unit);
          const generalShifts = activeShiftsRaw.filter((s: any) => !s.unit);
          
          const activeShifts = [
              ...specificShifts,
              ...generalShifts.filter((g: any) => {
                 const gStart = parseTime(g.startTime);
                 return !specificShifts.some((s: any) => {
                     const sStart = parseTime(s.startTime);
                     let diff = Math.abs(gStart - sStart);
                     if (diff > 720) diff = 1440 - diff;
                     return diff <= 240;
                 });
              })
          ];
          if (activeShifts.length === 0) return { start: 8 * 60, end: 16 * 60, tolerance: parseInt(absensiSettings.tolerance || '15') };
          let bestShift = activeShifts[0];
          let minDiff = Infinity;
          activeShifts.forEach((shift: any) => {
            const startMinutes = parseTime(shift.startTime);
            let diff = Math.abs(timeMinutes - startMinutes);
            if (diff > 720) diff = 1440 - diff;
            if (diff < minDiff) {
              minDiff = diff;
              bestShift = shift;
            }
          });

          const now = getServerTime();
          const day = now.getDay();
          let endTimeStr = bestShift.endTime;
          if (day === 5 && bestShift.fridayEndTime) {
            endTimeStr = bestShift.fridayEndTime;
          } else if (day === 6 && bestShift.saturdayEndTime) {
            endTimeStr = bestShift.saturdayEndTime;
          }

          const globalTol = absensiSettings?.tolerance;
          const parsedTol = (globalTol !== undefined && globalTol !== '' && !isNaN(Number(globalTol)))
            ? parseInt(String(globalTol), 10)
            : parseInt(String(bestShift.checkInAfterMinutes ?? '15'), 10);

          return {
            start: parseTime(bestShift.startTime),
            end: parseTime(endTimeStr),
            tolerance: isNaN(parsedTol) ? 15 : parsedTol
          };
        };

        const today = format(getServerTime(), 'yyyy-MM-dd');
        const todayAttendance = attendance.filter((a: any) => {
          if (a.date === today) return true;
          if (a.location && typeof a.location === 'object' && a.location.endDate) {
            return today >= a.date && today <= a.location.endDate;
          }
          return false;
        });
        const presentToday = todayAttendance.filter((a: any) => a.type === 'in' && a.status !== 'pending_telat' && a.status !== 'Ditolak');
        
        const lateToday = presentToday.filter((a: any) => {
          if (a.status === 'Hadir (Telat)') return true;
          const t = parseTime(a.time);
          const empUnit = employees.find((e: any) => e.nip === a.nip)?.unit;
          const shift = getShiftForTime(t, empUnit);
          return t > shift.start + shift.tolerance;
        });
        
        setStats([
          { title: "Total Karyawan", value: employees.length.toString(), icon: Users, color: "text-blue-600", bg: "bg-blue-100" },
          { title: "Hadir Hari Ini", value: presentToday.length.toString(), icon: UserCheck, color: "text-emerald-600", bg: "bg-emerald-100" },
          { title: "Terlambat", value: lateToday.length.toString(), icon: Clock, color: "text-amber-600", bg: "bg-amber-100" },
          { title: "Belum Absen", value: Math.max(0, employees.length - presentToday.length).toString(), icon: UserX, color: "text-red-600", bg: "bg-red-100" },
        ]);

        // Pending Approvals: Leave requests ('pending') and Late Check-ins ('pending_telat')
        setPendingLeaves(attendance.filter((a: any) => (['izin', 'sakit', 'Cuti', 'dinas_luar'].includes(a.type) && a.status === 'pending') || a.status === 'pending_telat'));

        // Not Checked Out: Checked in today, but no 'out' record
        const checkedInNips = presentToday.map((a: any) => a.nip);
        const checkedOutNips = todayAttendance.filter((a: any) => a.type === 'out').map((a: any) => a.nip);
        setNotCheckedOut(employees.filter((e: any) => checkedInNips.includes(e.nip) && !checkedOutNips.includes(e.nip)));
      } catch (error) {
        if (error instanceof TypeError && error.message.includes('fetch')) return;
        console.error('Failed to fetch data:', error);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard {appName}</h1>
        <p className="text-sm text-slate-500">Ringkasan absensi hari ini untuk {companyName}.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={index}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">
                  {stat.title}
                </CardTitle>
                <div className={`p-2 rounded-full ${stat.bg}`}>
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Permintaan Persetujuan Menunggu ({pendingLeaves.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingLeaves.length > 0 ? (
              <ul className="space-y-3">
                {pendingLeaves.map((leave, i) => {
                  const isLate = leave.status === 'pending_telat';
                  const typeLabel =
                    leave.type === 'dinas_luar'
                      ? 'Dinas Luar'
                      : leave.type === 'sakit'
                        ? 'Sakit'
                        : leave.type === 'Cuti' || leave.type === 'cuti'
                          ? 'Cuti Tahunan'
                          : leave.type === 'izin'
                            ? 'Izin'
                            : leave.type;
                  const reasonDetail = typeof leave.location === 'object' && leave.location !== null ? (leave.location.reason || leave.location.address) : (leave.location || '');
                  return (
                    <li key={leave.id || i} className="flex justify-between items-center text-sm text-slate-700 bg-slate-50 p-2 rounded-lg border gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{leave.name}</span>
                          {isLate ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                              Absen Telat
                            </span>
                          ) : (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                              leave.type === 'dinas_luar'
                                ? 'bg-purple-100 text-purple-800 border-purple-200'
                                : leave.type === 'sakit'
                                  ? 'bg-blue-100 text-blue-800 border-blue-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}>
                              {typeLabel}
                            </span>
                          )}
                        </div>
                        <span className="block text-xs text-slate-500 hover:text-slate-700 cursor-help truncate" title={reasonDetail || "Tanpa keterangan"}>
                          {isLate
                            ? `Telat Masuk (${leave.time || '-'}) - ${leave.date}${leave.shift ? ` • Shift ${leave.shift}` : ''}`
                            : `${typeLabel} - ${leave.date} ${(typeof leave.location === 'object' && leave.location !== null && leave.location.endDate && leave.location.endDate !== leave.date) ? `s/d ${leave.location.endDate}` : ""}${reasonDetail ? ` • "${reasonDetail}"` : ""}`}
                        </span>
                        {leave.photoUrl && leave.photoUrl !== 'Image too large to save in spreadsheet' && (
                          <button
                            type="button"
                            onClick={() => setPreviewAttachment({
                              url: leave.photoUrl,
                              title: `${isLate ? 'Foto Absen Telat' : `Bukti ${typeLabel}`} - ${leave.name} (${leave.date})`
                            })}
                            className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline mt-1"
                          >
                            <FileText className="h-3 w-3" />
                            {isLate ? 'Lihat Foto Absen' : 'Lihat Bukti Lampiran'}
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs px-2" onClick={() => handleApprove(leave.id, leave.type, 'approve', leave.status)}>Setujui</Button>
                        <Button size="sm" variant="destructive" className="h-8 text-xs px-2" onClick={() => handleApprove(leave.id, leave.type, 'reject', leave.status)}>Tolak</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-sm text-slate-500 text-center py-8">
                Tidak ada permintaan persetujuan baru.
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Karyawan Belum Checkout ({notCheckedOut.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {notCheckedOut.length > 0 ? (
              <ul className="space-y-2">
                {notCheckedOut.map((emp, i) => (
                  <li key={i} className="text-sm text-slate-700">{emp.name}</li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-500 text-center py-8">
                Semua karyawan shift pagi telah checkout.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!previewAttachment} onOpenChange={(open) => { if (!open) setPreviewAttachment(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{previewAttachment?.title}</DialogTitle>
          </DialogHeader>
          {previewAttachment && (
            <div className="space-y-3">
              <div className="flex flex-col items-center justify-center rounded-md border bg-slate-50 p-2 min-h-[200px]">
                <img
                  src={previewAttachment.url}
                  alt={previewAttachment.title}
                  className="max-h-96 w-auto rounded object-contain"
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.style.display = 'none';
                    const iframe = img.nextElementSibling as HTMLIFrameElement | null;
                    if (iframe) iframe.style.display = 'block';
                  }}
                />
                <iframe
                  src={previewAttachment.url}
                  title={previewAttachment.title}
                  className="hidden w-full h-96 rounded border bg-white"
                />
              </div>
              <div className="flex justify-end">
                <a
                  href={previewAttachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Buka di Tab Baru / Unduh
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
