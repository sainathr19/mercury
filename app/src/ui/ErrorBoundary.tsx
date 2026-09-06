import React from 'react';
import { View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Text } from './Text';
import { Button } from './Button';
import { posthog } from '../lib/posthog';

interface Props {
  children: React.ReactNode;
}
interface State {
  err: Error | null;
}

/** Catches render-time crashes anywhere in the tree and shows a recoverable
 *  fallback instead of an unstyled red screen. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error) {
    posthog.captureException(err);
  }

  render() {
    if (this.state.err) {
      return (
        <View style={styles.root}>
          <Text variant="titleMedium">Something went wrong</Text>
          <Text variant="bodyMedium" color={mutedColor()} style={styles.msg}>
            {String(this.state.err.message)}
          </Text>
          <Button title="Try again" onPress={() => this.setState({ err: null })} />
        </View>
      );
    }
    return this.props.children;
  }
}

const mutedColor = () => UnistylesRuntime.getTheme().colors.muted;

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.appBackground,
  },
  msg: { marginBottom: theme.spacing.md },
}));
