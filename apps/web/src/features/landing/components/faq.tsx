"use client";

import { Icon } from "@pickler/ui";
import { useState } from "react";
import styles from "../landing.module.css";
import { FAQ } from "../lib/demo";

/** QUESTIONS: one open at a time, the first open on arrival. */
export function Faq() {
  const [open, setOpen] = useState<number>(0);
  return (
    <section className={`${styles.shell} ${styles.faq}`} aria-labelledby="faq-title">
      <h2 id="faq-title" className={`${styles.title} ${styles.faqTitle}`}>
        QUESTIONS.
      </h2>
      <div className={styles.faqList}>
        {FAQ.map((item, index) => {
          const isOpen = open === index;
          return (
            <div key={item.q} className={styles.faqItem} data-open={isOpen || undefined}>
              <h3 className={styles.faqQ}>
                <button
                  type="button"
                  className={styles.faqButton}
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${index}`}
                  onClick={() => setOpen(isOpen ? -1 : index)}
                >
                  <span className={styles.faqQuestion}>{item.q}</span>
                  <span className={styles.faqChevron} aria-hidden="true">
                    <Icon name="chevronDown" size={14} />
                  </span>
                </button>
              </h3>
              {isOpen && (
                <p id={`faq-a-${index}`} className={styles.faqA}>
                  {item.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
