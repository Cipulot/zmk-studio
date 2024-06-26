import { AppHeader } from "./AppHeader";

import {
  create_rpc_connection,
  RpcConnection,
} from "@zmkfirmware/zmk-studio-ts-client";
import type { Notification } from "@zmkfirmware/zmk-studio-ts-client/studio";
import { ConnectionContext } from "./rpc/ConnectionContext";
import { Dispatch, useEffect, useState } from "react";
import { ConnectModal, TransportFactory } from "./ConnectModal";

import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { connect as gatt_connect } from "@zmkfirmware/zmk-studio-ts-client/transport/gatt";
import { connect as serial_connect } from "@zmkfirmware/zmk-studio-ts-client/transport/serial";
import {
  connect as tauri_ble_connect,
  list_devices as ble_list_devices,
} from "./tauri/ble";
import {
  connect as tauri_serial_connect,
  list_devices as serial_list_devices,
} from "./tauri/serial";
import Keyboard from "./keyboard/Keyboard";
import { UndoRedoContext, useUndoRedo } from "./undoRedo";
import { usePub } from "./usePubSub";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: object;
  }
}

const TRANSPORTS: TransportFactory[] = [
  navigator.bluetooth && { label: "BLE", connect: gatt_connect },
  navigator.serial && { label: "USB", connect: serial_connect },
  ...(window.__TAURI_INTERNALS__
    ? [
        {
          label: "BLE",
          pick_and_connect: {
            connect: tauri_ble_connect,
            list: ble_list_devices,
          },
        },
      ]
    : []),
  ...(window.__TAURI_INTERNALS__
    ? [
        {
          label: "USB",
          pick_and_connect: {
            connect: tauri_serial_connect,
            list: serial_list_devices,
          },
        },
      ]
    : []),
].filter((t) => t !== undefined);

async function listen_for_notifications(
  notification_stream: ReadableStream<Notification>
): Promise<void> {
  let reader = notification_stream.getReader();
  do {
    let pub = usePub();

    try {
      let { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      console.log("Notification", value);
      pub("rpc_notification", value);

      const subsystem = Object.entries(value).find(
        ([_k, v]) => v !== undefined
      );
      if (!subsystem) {
        continue;
      }

      const [subId, subData] = subsystem;
      const event = Object.entries(subData).find(([_k, v]) => v !== undefined);

      if (!event) {
        continue;
      }

      const [eventName, eventData] = event;
      const topic = ["rpc_notification", subId, eventName].join(".");

      pub(topic, eventData);
    } catch (e) {
      reader.releaseLock();
      throw e;
    }
  } while (true);

  reader.releaseLock();
}

async function connect(
  transport: RpcTransport,
  setConn: Dispatch<RpcConnection | null>
) {
  let rpc_conn = await create_rpc_connection(transport);

  listen_for_notifications(rpc_conn.notification_readable)
    .then(() => {
      setConn(null);
    })
    .catch((_e) => {
      setConn(null);
    });

  setConn(rpc_conn);
}

function App() {
  const [conn, setConn] = useState<RpcConnection | null>(null);
  const [doIt, undo, redo, canUndo, canRedo, reset] = useUndoRedo();

  useEffect(() => {
    if (!conn) {
      reset();
    }
  }, [conn]);

  return (
    <ConnectionContext.Provider value={conn}>
      <UndoRedoContext.Provider value={doIt}>
        <ConnectModal
          open={!conn}
          transports={TRANSPORTS}
          onTransportCreated={(t) => connect(t, setConn)}
        />
        <div className="bg-bg-base text-text-base h-full grid grid-cols-[auto] grid-rows-[auto_1fr]">
          <AppHeader connectedDeviceLabel={conn?.label} />
          <Keyboard />
          <button
            type="button"
            className="disabled:text-gray-500"
            id="undo"
            disabled={!canUndo}
            onClick={() => undo()}
          >
            Undo
          </button>
          <button
            type="button"
            className="disabled:text-gray-500"
            id="redo"
            disabled={!canRedo}
            onClick={() => redo()}
          >
            Redo
          </button>
        </div>
      </UndoRedoContext.Provider>
    </ConnectionContext.Provider>
  );
}

export default App;
