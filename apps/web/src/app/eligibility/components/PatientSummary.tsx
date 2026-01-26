'use client';

import type { PatientInfo } from '@eligibility-agent/shared';
import { User } from 'lucide-react';

interface PatientSummaryProps {
  patient: PatientInfo | null;
}

export default function PatientSummary({ patient }: PatientSummaryProps) {
  if (!patient) {
    return (
      <section className="card p-4">
        <h2 className="text-sm font-medium text-neutral-500 mb-2">Patient</h2>
        <div className="text-neutral-400 text-sm">No patient data available</div>
      </section>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Format SSN for display - mask all but last 4
  const formatSSN = (ssn: string) => {
    const digits = ssn.replace(/\D/g, '');
    if (digits.length >= 4) {
      return `***-**-${digits.slice(-4)}`;
    }
    return ssn;
  };

  const genderLabel = { M: 'Male', F: 'Female', U: 'Unknown' }[patient.gender];

  return (
    <section className="card p-4">
      <h2 className="text-sm font-medium text-neutral-500 mb-2">Patient</h2>

      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-neutral-400" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-neutral-900 truncate">
            {patient.firstName} {patient.middleName} {patient.lastName}
          </h3>

          {/* Responsive grid - stacks on very small screens */}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-neutral-600">
            <span>{formatDate(patient.dateOfBirth)}</span>
            <span className="hidden xs:inline">|</span>
            <span>{genderLabel}</span>
            {patient.ssn && (
              <>
                <span className="hidden sm:inline">|</span>
                <span className="font-mono text-xs">SSN: {formatSSN(patient.ssn)}</span>
              </>
            )}
          </div>

          {patient.address && (
            <p className="text-xs text-neutral-500 mt-1 truncate">
              {[
                patient.address.city,
                patient.address.state,
                patient.address.zipCode,
              ].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
