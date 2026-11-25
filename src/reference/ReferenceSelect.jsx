import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

export default function ReferenceSelect({
  label,
  value,
  options,
  onChange,
  icon,
  className = '',
  variant = 'control',
}) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootClassName = variant === 'account' ? 'account-switch' : 'select-control';

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listId, open]);

  const choose = option => {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = event => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }

    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setOpen(true);
      setActiveIndex(current => open
        ? (current + direction + options.length) % options.length
        : selectedIndex);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(options[activeIndex] || options[selectedIndex]);
      else {
        setActiveIndex(selectedIndex);
        setOpen(true);
      }
    }
  };

  const selected = options[selectedIndex];
  const activeOption = options[activeIndex] || selected;

  return (
    <div
      ref={rootRef}
      className={`${rootClassName} ${className}`.trim()}
      data-open={open}
    >
      {icon && <Icon name={icon} className={`select-leading-icon ${variant === 'account' ? 'account-meta' : ''}`} />}
      <span className="sr">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeOption ? `${listId}-option-${activeIndex}` : undefined}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen(current => !current);
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="select-value">{selected?.label ?? ''}</span>
        <Icon name="chevron-down" className={`select-chevron ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <div className="select-menu" id={listId} role="listbox" aria-label={label}>
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            const isActive = index === activeIndex;
            return (
              <button
                type="button"
                role="option"
                id={`${listId}-option-${index}`}
                className="select-option"
                aria-selected={isSelected}
                data-active={isActive}
                key={`${String(option.value)}-${index}`}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {isSelected && <Icon name="check" className="select-option-check" size={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
