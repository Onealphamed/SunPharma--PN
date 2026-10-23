// On-screen preview of a report with Print / Save as PDF and Word download.
// Report HTML is produced by reports.ts, where every data value is escaped.
import { downloadBlob } from './api';
import { useData } from './data';
import { fileSafe, wordBlob } from './reports';
import { Icon } from './ui';

export function printReport() {
  document.body.classList.add('printing-report');
  const done = () => {
    document.body.classList.remove('printing-report');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}

export function ReportActions({ title, html }: { title: string; html: string }) {
  const { project } = useData();
  return (
    <div className="row no-print">
      <button className="btn btn-sm btn-primary" onClick={printReport}><Icon name="print" /> Print / Save as PDF</button>
      <button className="btn btn-sm" onClick={() => downloadBlob(wordBlob(title, html), `PN0510_${fileSafe(title)}_${project.today}.doc`)}><Icon name="download" /> Word (.doc)</button>
    </div>
  );
}

export function ReportPreview({ html }: { html: string }) {
  return <div className="report-preview print-target" dangerouslySetInnerHTML={{ __html: html }} />;
}
