import { describe, expect, it } from 'vitest';
import { classify } from './classify';

describe('classify', () => {
  it.each([
    ['USB-C-SMD_TYPE-C-6PIN-2MD', undefined, 'usb-c'],
    ['USB-3.0TYPEC-SMD', 'J1', 'usb-c'],
    ['SW-SMD_4P-L4_5-W4_5-P3_00', undefined, 'button'],
    ['KEY-4.5X4.5-SMD', 'K3', 'button'],
    ['SW-SMD_MST22D18G2_SW-SMD_MST22D', undefined, 'switch'],
    ['SWITCH_6PIN_2P', 'SW1', 'switch'],
    ['TF-SMD', undefined, 'sd'],
    ['CONN-SMD_2P-P2_00_BX-PH2_0-2', undefined, 'jst'],
    ['XH2.54-4P-SMD', 'J10', 'jst'],
    ['CONNECTOR_4P-SMD-2.0', 'J2', 'jst'],
    ['H1_HDR-SMD_40P-P2_54-V-F-R2', undefined, 'header'],
    ['WIFIM-SMD_61P-L16_6-W13_2', undefined, 'module'],
    ['LCD-10-1CUN', undefined, 'display'],
    ['TP-10-1CUN', undefined, 'display'],
    ['LED', undefined, 'led'],
    ['Button_Switch_SMD:SW_SPST_PTS645', 'SW2', 'button'],
    ['Connector_USB:USB_Micro-B_Molex-105017-0001', 'J1', 'micro-usb'],
    ['R_0402', 'R12', null],
    ['C_0603', 'C3', null],
  ])('%s (%s) → %s', (name, ref, kind) => {
    expect(classify(name, ref)).toBe(kind);
  });
});
