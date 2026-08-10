import React from 'react';
import { theme } from './theme';

export default function GlobalStyles() {
  return (
    <style>
      {`
        :root {
          --ui-font-body: "Dustin Sans", "Avenir Next", "Segoe UI", Arial, sans-serif;
          --ui-font-display: "Gilroy", "Montserrat", "Avenir Next", Arial, sans-serif;
          --ui-font-mono: "Cascadia Code", "Consolas", monospace;
          --ui-unified-bg: var(--ui-background-color, ${theme.colors.canvas});
        }

        * {
          box-sizing: border-box;
        }

        * {
          min-width: 0;
        }

        html,
        body,
        #root {
          font-family: var(--ui-font-body);
        }

        html {
          scroll-behavior: smooth;
        }

        body {
          margin: 0;
          background: var(--ui-unified-bg);
          color: ${theme.colors.ink};
          font-family: var(--ui-font-body);
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        body,
        button,
        input,
        select,
        textarea {
          font-family: var(--ui-font-body);
        }

        body :where(*:not(code):not(pre):not(kbd):not(samp)) {
          font-family: inherit;
        }

        h1,
        h2,
        h3,
        h4,
        h5,
        h6,
        [role="heading"],
        [data-ui-font="header"],
        .workspace-mobile-title,
        .landing-brand strong,
        .landing-section-head h2,
        .landing-category-editorial-copy h2 {
          font-family: var(--ui-font-display);
        }

        code,
        pre,
        kbd,
        samp {
          font-family: var(--ui-font-mono);
        }

        img {
          display: block;
          max-width: 100%;
        }

        table {
          max-width: 100%;
        }

        th,
        td {
          overflow-wrap: break-word;
          word-break: normal;
        }

        button,
        input,
        select,
        textarea {
          border: 0;
        }

        input,
        select,
        textarea {
          max-width: 100%;
        }

        a {
          color: inherit;
        }

        .glass-panel {
          background: var(--ui-unified-bg);
          backdrop-filter: none;
          border: 1px solid rgba(24, 33, 46, 0.08);
          box-shadow: ${theme.shadows.panel};
          max-width: 100%;
        }

        .workspace-shell,
        .workspace-main,
        .workspace-content,
        .workspace-topbar,
        .workspace-sidebar-panel,
        .workspace-sidebar-drawer,
        .workspace-sidebar-wrap,
        .workspace-content > div,
        .workspace-content .glass-panel,
        .workspace-content .booking-hub,
        .workspace-content .booking-table-wrap,
        .workspace-content .responsive-table-wrap,
        .workspace-content table,
        .workspace-content thead,
        .workspace-content tbody,
        .workspace-content tbody tr,
        .workspace-content section,
        .workspace-content article,
        .workspace-content .saved-listings-card,
        .workspace-content .rental-income-card,
        .workspace-content .rent-order-card,
        .workspace-content .item-detail-card,
        .workspace-content .item-detail-wide-section,
        .order-track-card,
        .order-kpis article,
        .order-table,
        .seller-analytics-cards article,
        .seller-trend-card,
        .seller-action-card,
        .seller-recent-card,
        .seller-action-list div,
        .inventory-stat-card,
        .inventory-table-shell,
        .inventory-mobile-card,
        .market-page,
        .landing-nav,
        .landing-toolbar,
        .landing-categories-sticky,
        .landing-main,
        .landing-nearby,
        .landing-catalog,
        .landing-search,
        .landing-controls.inline,
        .landing-trust-row article,
        .market-product-card,
        .market-empty,
        .market-alert,
        .market-faq-list details {
          background: var(--ui-unified-bg) !important;
        }

        .workspace-shell,
        .workspace-main,
        .workspace-content {
          min-width: 0;
        }

        .workspace-content > div {
          max-width: 100%;
        }

        .section-grid {
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)) !important;
        }

        .booking-table-wrap,
        .responsive-table-wrap {
          -webkit-overflow-scrolling: touch;
          max-width: 100%;
          overflow-x: auto;
        }

        .interactive-panel {
          transition: border-color 180ms ease;
        }

        .interactive-panel:hover {
          border-color: rgba(24, 33, 46, 0.12);
        }

        /* Table row hover */
        table tbody tr {
          transition: background 120ms ease;
        }

        table tbody tr:hover td {
          background: rgba(24, 33, 46, 0.025);
        }

        /* Scrollbar styling for horizontal table overflow */
        .booking-table-wrap::-webkit-scrollbar,
        .responsive-table-wrap::-webkit-scrollbar {
          height: 6px;
        }

        .booking-table-wrap::-webkit-scrollbar-track,
        .responsive-table-wrap::-webkit-scrollbar-track {
          background: rgba(24, 33, 46, 0.04);
          border-radius: 999px;
        }

        .booking-table-wrap::-webkit-scrollbar-thumb,
        .responsive-table-wrap::-webkit-scrollbar-thumb {
          background: rgba(24, 33, 46, 0.18);
          border-radius: 999px;
        }

        .workspace-sidebar-drawer,
        .workspace-sidebar-backdrop {
          display: none;
        }

        @media (max-width: 1100px) {
          .landing-grid,
          .two-column,
          .auth-shell {
            grid-template-columns: 1fr !important;
          }

          .auth-divider {
            display: none !important;
          }

          .auth-visual,
          .auth-form-stage {
            min-height: auto !important;
          }

          .section-grid,
          .panel-grid,
          .form-grid {
            grid-template-columns: 1fr !important;
          }

          .glass-panel {
            padding: 20px !important;
          }
        }

        @media (max-width: 768px) {
          .auth-visual {
            padding: 36px 28px !important;
          }

          .auth-form-stage {
            padding: 36px 28px 48px !important;
          }
        }

        @media (max-width: 980px) {
          .workspace-sidebar-drawer,
          .workspace-sidebar-backdrop {
            display: block;
          }

          .workspace-topbar {
            min-height: 72px;
          }

          .workspace-content {
            padding-left: 14px !important;
            padding-right: 14px !important;
          }

          .responsive-panel-auto,
          .responsive-scroll-form {
            height: auto !important;
            max-height: none !important;
          }

          .responsive-scroll-form {
            overflow: visible !important;
            padding-right: 0 !important;
          }

          .responsive-sticky-reset {
            position: static !important;
            top: auto !important;
          }

          .responsive-preview-shell,
          .responsive-modal-grid {
            grid-template-columns: 1fr !important;
          }

          .responsive-preview-shell {
            min-height: 0 !important;
          }
        }

        @media (max-width: 820px) {
          .workspace-mobile-title {
            max-width: 38vw;
          }

          .auth-visual {
            padding: 28px 22px !important;
          }

          .auth-form-stage {
            padding: 28px 22px 40px !important;
          }
        }

        @media (max-width: 640px) {
          body {
            font-size: 15px;
          }

          .workspace-mobile-title {
            max-width: 44vw;
          }

          .app-modal-backdrop {
            padding: 10px !important;
          }

          .app-modal-content {
            border-radius: 12px !important;
            max-height: calc(100dvh - 20px) !important;
            padding: 16px !important;
          }

          .workspace-topbar {
            gap: 10px;
          }

          .responsive-detail-row,
          .responsive-split-input {
            grid-template-columns: 1fr !important;
          }

          .responsive-detail-row {
            gap: 6px !important;
          }

          .responsive-flex-stack {
            align-items: stretch !important;
            flex-direction: column !important;
          }

          .responsive-flex-stack-start {
            align-items: flex-start !important;
            flex-direction: column !important;
          }

          .responsive-action-row {
            align-items: stretch !important;
            flex-direction: column !important;
          }

          .responsive-action-row > * {
            width: 100% !important;
          }

          .glass-panel {
            padding: 16px !important;
          }
        }
      `}
    </style>
  );
}
