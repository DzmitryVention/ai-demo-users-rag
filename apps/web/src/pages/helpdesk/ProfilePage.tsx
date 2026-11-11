import { UpdateProfileSchema } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../auth/AuthProvider.tsx';
import {
  Avatar,
  Button,
  Card,
  PageHeader,
  TextAreaField,
  TextField,
} from '../../components/ui/index.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fullName } from '../../lib/format.ts';

export function ProfilePage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: api.updateMe,
    onSuccess: (updated) => {
      queryClient.setQueriesData({ queryKey: ['me'] }, updated);
      toast.success('Profile saved');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!me) return null;

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = UpdateProfileSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    save.mutate({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      phone: parsed.data.phone ?? '',
      about: parsed.data.about ?? '',
    });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Your profile" description="This information helps our team support you." />
      <Card className="p-6">
        <div className="mb-6 flex items-center gap-4">
          <Avatar name={fullName(me)} src={me.avatarUrl} size="lg" />
          <div>
            <p className="font-medium">{fullName(me)}</p>
            <p className="text-sm text-slate-500">{me.email}</p>
          </div>
        </div>
        <form onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="firstName"
            label="Name"
            defaultValue={me.firstName}
            autoComplete="given-name"
            maxLength={100}
            error={errors['firstName']}
            required
          />
          <TextField
            name="lastName"
            label="Surname"
            defaultValue={me.lastName}
            autoComplete="family-name"
            maxLength={100}
            error={errors['lastName']}
            required
          />
          <TextField
            label="Email"
            value={me.email}
            readOnly
            disabled
            hint="Managed by your Google account"
          />
          <TextField
            name="phone"
            type="tel"
            label="Phone number"
            defaultValue={me.phone ?? ''}
            autoComplete="tel"
            placeholder="+1 555 123 4567"
            maxLength={32}
            error={errors['phone']}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              name="about"
              label="About"
              defaultValue={me.about ?? ''}
              rows={4}
              maxLength={2000}
              placeholder="A few words about yourself"
              error={errors['about']}
            />
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={save.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
