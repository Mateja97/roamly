import type { Ref } from 'react';
import { TextField } from './controls/TextField';
import { SelectField } from './controls/SelectField';
import { TextareaField } from './controls/TextareaField';
import { CATEGORY_OPTIONS } from '../constants';

export interface BasicsSectionProps {
  name: string;
  onNameChange: (value: string) => void;
  onNameBlur: () => void;
  nameError?: string;
  nameInputRef?: Ref<HTMLInputElement>;

  category: string;
  onCategoryChange: (value: string) => void;
  onCategoryBlur: () => void;
  categoryError?: string;
  categorySelectRef?: Ref<HTMLSelectElement>;

  city: string;
  onCityChange: (value: string) => void;

  description: string;
  onDescriptionChange: (value: string) => void;

  disabled?: boolean;
}

/** Basics: name / category / city / description. Name and category are
 * required (validated on blur); city and description are optional. */
export function BasicsSection({
  name,
  onNameChange,
  onNameBlur,
  nameError,
  nameInputRef,
  category,
  onCategoryChange,
  onCategoryBlur,
  categoryError,
  categorySelectRef,
  city,
  onCityChange,
  description,
  onDescriptionChange,
  disabled,
}: BasicsSectionProps) {
  return (
    <section className="admin-card admin-section">
      <h2 className="admin-section-heading">Basics</h2>
      <div className="admin-basics-grid">
        <TextField
          label="Activity name"
          value={name}
          onChange={onNameChange}
          onBlur={onNameBlur}
          error={nameError}
          disabled={disabled}
          ref={nameInputRef}
        />
        <div className="admin-basics-row">
          <SelectField
            label="Category"
            value={category}
            onChange={onCategoryChange}
            onBlur={onCategoryBlur}
            options={CATEGORY_OPTIONS}
            placeholder="Select a category"
            error={categoryError}
            disabled={disabled}
            ref={categorySelectRef}
          />
          <TextField
            label="City"
            value={city}
            onChange={onCityChange}
            disabled={disabled}
          />
        </div>
        <TextareaField
          label="Short description"
          value={description}
          onChange={onDescriptionChange}
          disabled={disabled}
        />
      </div>
    </section>
  );
}
