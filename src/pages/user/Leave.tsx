import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, FileText, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { getServerTime } from '@/lib/time';

export default function UserLeave() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [leaveType, setLeaveType] = useState<string>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [user, setUser] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('Lampiran Bukti');

  const [leaveHistory, setLeaveHistory] = useState<any[]>([]);

  const requireProofDinasLuar = settings?.leaveSettings?.requireProofDinasLuar !== false;
  const requireProofSakit = settings?.leaveSettings?.requireProofSakit !== false;
  const requiresProof =
    (leaveType === 'dinas_luar' && requireProofDinasLuar) ||
    (leaveType === 'sakit' && requireProofSakit);

  useEffect(() => {
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    setUser(userData);

    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setSettings(data))
      .catch(err => console.error('Error fetching settings:', err));

    fetch('/api/attendance')
      .then(res => res.json())
      .then(data => {
        const history = data.filter((a: any) =>
          a.nip === userData.nip &&
          ['izin', 'sakit', 'cuti', 'Cuti', 'dinas_luar'].includes(a.type)
        );
        setLeaveHistory(history.reverse());
      })
      .catch(err => console.error('Error fetching history:', err));
  }, []);

  const handleLeaveTypeChange = (value: string) => {
    setLeaveType(value);
    if (value === 'dinas_luar' && requireProofDinasLuar) {
      toast.warning(
        'Izin Dinas Luar wajib melampirkan bukti (surat tugas atau foto kegiatan) agar tombol Ajukan Izin dapat ditekan.',
        { duration: 6000 }
      );
    } else if (value === 'sakit' && requireProofSakit) {
      toast.warning(
        'Izin Sakit wajib melampirkan bukti (surat keterangan dokter atau foto bukti sakit) agar tombol Ajukan Izin dapat ditekan.',
        { duration: 6000 }
      );
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setAttachment(null);
      return;
    }

    if (!file.type.startsWith('image/') && file.size > 35000) {
      toast.error(
        'Ukuran file dokumen/PDF maksimal 35 KB agar tersimpan penuh. Disarankan unggah foto surat/kegiatan (JPG/PNG) karena akan dikompres otomatis.',
        { duration: 6000 }
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      setAttachment(null);
      return;
    }

    setAttachment(file);
    toast.success(`Bukti "${file.name}" berhasil dipilih. Anda dapat mengajukan izin sekarang.`);
  };

  const handleRemoveAttachment = () => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (requiresProof) {
      toast.info('Lampiran dihapus. Unggah kembali bukti untuk mengaktifkan tombol Ajukan Izin.');
    }
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          const MAX_WIDTH = 400;
          const MAX_HEIGHT = 400;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          let result = canvas.toDataURL('image/jpeg', 0.5);
          if (result.length > 48000) {
            result = canvas.toDataURL('image/jpeg', 0.3);
          }
          resolve(result);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const getBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const getLocation = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation tidak didukung oleh browser ini'));
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
    });
  };

  const getLeaveTypeLabel = (rawType: string) => {
    switch (rawType) {
      case 'dinas_luar':
        return 'Dinas Luar';
      case 'sakit':
        return 'Sakit';
      case 'Cuti':
      case 'cuti':
        return 'Cuti Tahunan';
      case 'izin':
        return 'Izin Keperluan Pribadi';
      default:
        return rawType.replace('_', ' ');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveType) {
      toast.error('Pilih jenis izin terlebih dahulu');
      return;
    }

    if (requiresProof && !attachment) {
      toast.error(
        leaveType === 'dinas_luar'
          ? 'Bukti Dinas Luar (surat atau foto kegiatan) wajib dilampirkan!'
          : 'Bukti Sakit (surat dokter atau foto bukti sakit) wajib dilampirkan!'
      );
      return;
    }

    if (startDate && endDate && endDate < startDate) {
      toast.error('Tanggal selesai tidak boleh lebih awal dari tanggal mulai');
      return;
    }

    setLoading(true);

    try {
      const attResponse = await fetch('/api/attendance');
      if (attResponse.ok) {
        const attData = await attResponse.json();
        const hasCheckedInOnStartDate = attData.some((a: any) => a.nip === user?.nip && a.date === startDate && a.type === 'in');
        if (hasCheckedInOnStartDate) {
          toast.error('Anda sudah melakukan absen masuk pada tanggal tersebut, tidak bisa mengajukan izin.');
          setLoading(false);
          return;
        }
      }

      let lat = null;
      let lng = null;
      try {
        toast.info('Mengambil lokasi Anda...');
        const pos = await getLocation();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch (locErr: any) {
        toast.error('Gagal mendapatkan lokasi: ' + locErr.message);
      }

      let type = '';
      let status = '';

      if (leaveType === 'izin') {
        type = 'izin';
      } else if (leaveType === 'sakit') {
        type = 'sakit';
      } else if (leaveType === 'cuti') {
        type = 'Cuti';
      } else if (leaveType === 'dinas_luar') {
        type = 'dinas_luar';
      }

      const autoApprove = settings?.leaveSettings?.autoApprove;
      const mustAdminApprove =
        type === 'dinas_luar' ||
        type === 'sakit' ||
        !autoApprove ||
        autoApprove === 'false' ||
        autoApprove === false ||
        autoApprove === '0' ||
        autoApprove === 0;

      if (mustAdminApprove) {
        status = 'pending';
      } else {
        if (type === 'izin') status = 'izin';
        else if (type === 'Cuti') status = 'Cuti';
      }

      let fileData = '';
      if (attachment) {
        if (attachment.type.startsWith('image/')) {
          fileData = await compressImage(attachment);
        } else {
          fileData = await getBase64(attachment);
        }
      }

      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nip: user?.nip || 'N/A',
          name: user?.name || 'N/A',
          date: startDate,
          time: getServerTime().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
          type: type,
          location: { lat, lng, reason, endDate, fileName: attachment?.name || '' },
          status: status,
          photoUrl: fileData,
        }),
      });

      const respJson = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(respJson.message || 'Gagal mengajukan izin');
      }

      if (status === 'pending' && user?.nip && respJson.id) {
        const storageKey = `knownPendingLeaveIds_${user.nip}`;
        const existingIds: string[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (!existingIds.includes(String(respJson.id))) {
          localStorage.setItem(storageKey, JSON.stringify([...existingIds, String(respJson.id)]));
        }
      }

      toast.success(
        status === 'pending'
          ? 'Permintaan izin berhasil diajukan dan sedang menunggu persetujuan atasan.'
          : 'Permintaan izin berhasil diajukan dan disetujui.'
      );
      setLoading(false);
      setLeaveType('');
      setStartDate('');
      setEndDate('');
      setReason('');
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      setTimeout(() => {
        navigate('/user');
      }, 900);
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Terjadi kesalahan saat mengajukan izin');
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">Pengajuan Izin</h1>
        <p className="text-sm text-slate-400">Ajukan izin tidak masuk kerja beserta bukti pendukung.</p>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-50">
        <CardHeader>
          <CardTitle className="text-lg">Formulir Izin</CardTitle>
          <CardDescription className="text-slate-400">Isi detail izin Anda di bawah ini.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="type" className="text-slate-300">Jenis Izin</Label>
              <Select required value={leaveType} onValueChange={handleLeaveTypeChange}>
                <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-50">
                  <SelectValue placeholder="Pilih jenis izin" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-50">
                  <SelectItem value="sakit">Sakit</SelectItem>
                  <SelectItem value="cuti">Cuti Tahunan</SelectItem>
                  <SelectItem value="izin">Izin Keperluan Pribadi</SelectItem>
                  <SelectItem value="dinas_luar">Dinas Luar</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {requiresProof && (
              attachment ? (
                <Alert className="bg-emerald-950/60 border-emerald-700/60 text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <AlertDescription className="text-xs leading-relaxed">
                    Bukti <strong>{attachment.name}</strong> telah dilampirkan. Silakan lengkapi data dan tekan tombol <strong>Ajukan Izin</strong>. Pengajuan akan diteruskan untuk persetujuan atasan.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="bg-amber-950/60 border-amber-700/60 text-amber-200">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <AlertDescription className="text-xs leading-relaxed">
                    <strong>Bukti Wajib Dilampirkan!</strong> Untuk izin <strong>{leaveType === 'dinas_luar' ? 'Dinas Luar' : 'Sakit'}</strong>, Anda wajib mengunggah {leaveType === 'dinas_luar' ? 'surat tugas/perintah atau foto kegiatan dinas luar' : 'surat keterangan dokter atau foto bukti sakit'}. Tombol <strong>Ajukan Izin</strong> tidak dapat ditekan sebelum bukti dilampirkan.
                  </AlertDescription>
                </Alert>
              )
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate" className="text-slate-300">Mulai Tanggal</Label>
                <Input id="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-slate-950 border-slate-800 text-slate-50 [color-scheme:dark]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate" className="text-slate-300">Sampai Tanggal</Label>
                <Input id="endDate" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-slate-950 border-slate-800 text-slate-50 [color-scheme:dark]" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason" className="text-slate-300">Keterangan / Alasan</Label>
              <Input id="reason" placeholder="Tuliskan alasan..." required value={reason} onChange={(e) => setReason(e.target.value)} className="bg-slate-950 border-slate-800 text-slate-50" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="attachment" className="text-slate-300 flex items-center justify-between">
                <span>
                  {leaveType === 'dinas_luar'
                    ? 'Bukti Dinas Luar (Surat Tugas / Foto Kegiatan)'
                    : leaveType === 'sakit'
                      ? 'Bukti Sakit (Surat Dokter / Foto Bukti Sakit)'
                      : 'Lampiran (Surat / Foto Bukti)'}
                  {requiresProof && <span className="text-rose-400 ml-1">*Wajib</span>}
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  ref={fileInputRef}
                  id="attachment"
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  onChange={handleFileChange}
                  className={`bg-slate-950 text-slate-50 file:text-emerald-400 ${
                    requiresProof && !attachment ? 'border-amber-500/70' : 'border-slate-800'
                  }`}
                />
                {attachment && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleRemoveAttachment}
                    className="shrink-0 border-slate-700 bg-slate-950 text-rose-400 hover:bg-rose-950/40 hover:text-rose-300"
                    title="Hapus lampiran"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Upload className="h-3 w-3" />
                Unggah foto (JPG/PNG, otomatis dikompres) atau surat PDF (maks. 35 KB).
              </p>
            </div>

            <Button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white mt-4 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed"
              disabled={loading || !leaveType || (requiresProof && !attachment)}
            >
              {loading
                ? 'Mengirim...'
                : requiresProof && !attachment
                  ? 'Lampirkan Bukti Terlebih Dahulu'
                  : 'Ajukan Izin'}
            </Button>
            {requiresProof && !attachment && (
              <p className="text-xs text-amber-400 text-center">
                Tombol Ajukan Izin akan aktif setelah Anda melampirkan bukti {leaveType === 'dinas_luar' ? 'Dinas Luar' : 'Sakit'}.
              </p>
            )}
          </CardContent>
        </form>
      </Card>

      <div className="mt-8">
        <h3 className="text-lg font-medium text-white mb-4">Riwayat Pengajuan</h3>
        <div className="space-y-3 pb-8">
          {leaveHistory.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">Belum ada riwayat pengajuan.</p>
          ) : (
            leaveHistory.map((history, idx) => {
              let displayReason = history.location;
              const hasAttachment = !!history.photoUrl && history.photoUrl !== 'Image too large to save in spreadsheet';
              if (typeof history.location === 'object' && history.location !== null) {
                displayReason = history.location.reason;
              }
              return (
                <Card key={history.id || idx} className="bg-slate-900 border-slate-800 text-slate-50">
                  <CardContent className="p-4 flex flex-col justify-between items-start gap-2">
                    <div className="w-full flex justify-between items-center gap-2">
                      <div>
                        <p className="font-medium">{getLeaveTypeLabel(history.type)}</p>
                        <p className="text-xs text-slate-400">
                          {history.date} {(typeof history.location === 'object' && history.location !== null && history.location.endDate && history.location.endDate !== history.date) ? `s/d ${history.location.endDate}` : ''}
                        </p>
                        {displayReason && (
                          <p className="text-xs text-slate-500 mt-1 italic">"{displayReason}"</p>
                        )}
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded border shrink-0 ${
                        history.status === 'pending'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : history.status === 'Ditolak'
                            ? 'bg-red-500/10 text-red-400 border-red-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      }`}>
                        {history.status === 'pending' ? 'Menunggu Persetujuan' : history.status === 'Ditolak' ? 'Ditolak' : 'Disetujui'}
                      </span>
                    </div>
                    {hasAttachment && (
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewUrl(history.photoUrl);
                          setPreviewTitle(`Bukti ${getLeaveTypeLabel(history.type)} (${history.date})`);
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 underline mt-1 inline-flex items-center gap-1"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Lihat Lampiran Bukti
                      </button>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      <Dialog open={!!previewUrl} onOpenChange={(open) => { if (!open) setPreviewUrl(null); }}>
        <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-800 text-slate-50">
          <DialogHeader>
            <DialogTitle>{previewTitle}</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <div className="space-y-3">
              {previewUrl.startsWith('data:application/pdf') ? (
                <iframe src={previewUrl} title={previewTitle} className="w-full h-96 rounded border border-slate-700 bg-white" />
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={previewUrl}
                    alt={previewTitle}
                    className="max-h-96 w-auto rounded border border-slate-700 object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <a
                    href={previewUrl}
                    download="bukti_izin"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-emerald-400 underline"
                  >
                    Buka / Unduh Dokumen Bukti
                  </a>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
